import { Router, Request, Response } from 'express';
import Stripe from 'stripe';
import { getDb } from '../utils/database';
import { authenticateToken } from '../middleware/auth';
import { SUBSCRIPTION_TIERS } from '../models/types';
import { calculateTrialEndDate } from '../utils/subscription';

const router = Router();

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

// POST /api/payments/create-checkout
router.post('/create-checkout', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!stripe) {
      res.status(503).json({ detail: 'Payment service not configured' });
      return;
    }

    const { tier, origin_url } = req.body;
    const user = req.user!;

    // Validate tier
    if (!['basic', 'pro'].includes(tier)) {
      res.status(400).json({ detail: 'Invalid subscription tier' });
      return;
    }

    // Get price based on tier
    const tierConfig = SUBSCRIPTION_TIERS[tier as keyof typeof SUBSCRIPTION_TIERS];
    const price = tierConfig.price;

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `${tierConfig.name} Subscription`,
              description: tierConfig.features.join(', ')
            },
            unit_amount: Math.round(price * 100), // Stripe uses cents
            recurring: {
              interval: 'month'
            }
          },
          quantity: 1
        }
      ],
      mode: 'subscription',
      success_url: `${origin_url}/subscription-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin_url}/pricing`,
      metadata: {
        user_id: user.id,
        user_email: user.email,
        subscription_tier: tier,
        trial_days: '7'
      },
      subscription_data: {
        trial_period_days: 7
      }
    });

    // Store pending transaction
    const db = getDb();
    const transaction = {
      session_id: session.id,
      user_id: user.id,
      user_email: user.email,
      subscription_tier: tier,
      amount: price,
      currency: 'usd',
      payment_status: 'pending',
      created_at: new Date()
    };

    await db.collection('payment_transactions').insertOne(transaction);

    res.json({
      success: true,
      checkout_url: session.url,
      session_id: session.id
    });
  } catch (error) {
    console.error('Create checkout error:', error);
    res.status(500).json({ detail: 'Failed to create checkout session' });
  }
});

// GET /api/payments/checkout-status/:sessionId
router.get('/checkout-status/:sessionId', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!stripe) {
      res.status(503).json({ detail: 'Payment service not configured' });
      return;
    }

    const { sessionId } = req.params;

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const db = getDb();

    // Find transaction
    const transaction = await db.collection('payment_transactions').findOne({ session_id: sessionId });

    if (!transaction) {
      res.status(404).json({ detail: 'Transaction not found' });
      return;
    }

    // Update transaction status if payment completed
    if (session.payment_status === 'paid' && transaction.payment_status !== 'paid') {
      await db.collection('payment_transactions').updateOne(
        { session_id: sessionId },
        {
          $set: {
            payment_status: 'paid',
            paid_at: new Date()
          }
        }
      );

      // Activate subscription with trial
      const trialEnd = calculateTrialEndDate();
      const subscriptionEnd = new Date(trialEnd);
      subscriptionEnd.setDate(subscriptionEnd.getDate() + 30); // 1 month after trial

      await db.collection('users').updateOne(
        { id: transaction.user_id },
        {
          $set: {
            subscription_tier: transaction.subscription_tier,
            subscription_active: true,
            trial_active: true,
            trial_end_date: trialEnd,
            subscription_end_date: subscriptionEnd,
            subscription_started_at: new Date()
          }
        }
      );

      console.log(`Activated ${transaction.subscription_tier} subscription for user ${transaction.user_id}`);
    }

    res.json({
      success: true,
      payment_status: session.payment_status,
      status: session.status,
      amount: session.amount_total,
      subscription_tier: transaction.subscription_tier,
      transaction_updated: transaction.payment_status !== session.payment_status
    });
  } catch (error) {
    console.error('Checkout status error:', error);
    res.status(500).json({ detail: 'Failed to check checkout status' });
  }
});

// POST /api/payments/webhook/stripe
router.post('/webhook/stripe', async (req: Request, res: Response) => {
  try {
    if (!stripe) {
      res.status(503).json({ detail: 'Payment service not configured' });
      return;
    }

    const sig = req.headers['stripe-signature'] as string;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event: Stripe.Event;

    if (webhookSecret) {
      try {
        event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
      } catch (err: any) {
        console.error('Webhook signature verification failed:', err.message);
        res.status(400).json({ detail: `Webhook Error: ${err.message}` });
        return;
      }
    } else {
      event = req.body as Stripe.Event;
    }

    console.log(`Stripe webhook: ${event.type}`);

    // Handle the event
    switch (event.type) {
      case 'checkout.session.completed':
        const session = event.data.object as Stripe.Checkout.Session;
        console.log(`Checkout completed for session ${session.id}`);
        break;
      case 'customer.subscription.updated':
        console.log('Subscription updated');
        break;
      case 'customer.subscription.deleted':
        console.log('Subscription cancelled');
        break;
      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    res.json({ success: true, event_type: event.type });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ detail: 'Webhook processing failed' });
  }
});

// GET /api/payments/subscription-plans
router.get('/subscription-plans', async (req: Request, res: Response) => {
  res.json({
    success: true,
    plans: [
      {
        tier: 'basic',
        name: SUBSCRIPTION_TIERS.basic.name,
        price: SUBSCRIPTION_TIERS.basic.price,
        features: SUBSCRIPTION_TIERS.basic.features,
        trial_days: 7
      },
      {
        tier: 'pro',
        name: SUBSCRIPTION_TIERS.pro.name,
        price: SUBSCRIPTION_TIERS.pro.price,
        features: SUBSCRIPTION_TIERS.pro.features,
        trial_days: 7
      }
    ]
  });
});

export default router;
