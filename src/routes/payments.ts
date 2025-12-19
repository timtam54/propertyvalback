import { Router, Request, Response } from 'express';
import Stripe from 'stripe';
import { queryOne, execute } from '../utils/database';
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

    if (!['basic', 'pro'].includes(tier)) {
      res.status(400).json({ detail: 'Invalid subscription tier' });
      return;
    }

    const tierConfig = SUBSCRIPTION_TIERS[tier as keyof typeof SUBSCRIPTION_TIERS];
    const price = tierConfig.price;

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
            unit_amount: Math.round(price * 100),
            recurring: {
              interval: 'month'
            }
          },
          quantity: 1
        }
      ],
      mode: 'subscription',
      success_url: `${origin_url || 'http://localhost:3000'}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin_url || 'http://localhost:3000'}/payment/cancel`,
      customer_email: user.email,
      metadata: {
        user_id: user.id,
        tier: tier
      }
    });

    res.json({
      success: true,
      session_id: session.id,
      url: session.url
    });
  } catch (error: any) {
    console.error('Create checkout error:', error);
    res.status(500).json({ detail: 'Failed to create checkout session: ' + error.message });
  }
});

// POST /api/payments/webhook
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    if (!stripe) {
      res.status(503).json({ detail: 'Payment service not configured' });
      return;
    }

    const sig = req.headers['stripe-signature'] as string;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
      console.error('Stripe webhook secret not configured');
      res.status(503).json({ detail: 'Webhook not configured' });
      return;
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err: any) {
      console.error('Webhook signature verification failed:', err.message);
      res.status(400).json({ detail: `Webhook Error: ${err.message}` });
      return;
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.user_id;
        const tier = session.metadata?.tier || 'basic';

        if (userId) {
          const subscriptionEndDate = new Date();
          subscriptionEndDate.setMonth(subscriptionEndDate.getMonth() + 1);

          await execute(
            `UPDATE users SET
              subscription_tier = @tier,
              subscription_active = 1,
              subscription_end_date = @endDate,
              stripe_customer_id = @customerId,
              stripe_subscription_id = @subscriptionId
             WHERE id = @userId`,
            {
              tier,
              endDate: subscriptionEndDate,
              customerId: session.customer as string,
              subscriptionId: session.subscription as string,
              userId
            }
          );
          console.log(`[Payments] Updated subscription for user ${userId} to ${tier}`);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        await execute(
          `UPDATE users SET subscription_active = 0 WHERE stripe_subscription_id = @subscriptionId`,
          { subscriptionId: subscription.id }
        );
        console.log(`[Payments] Cancelled subscription ${subscription.id}`);
        break;
      }
    }

    res.json({ received: true });
  } catch (error: any) {
    console.error('Webhook error:', error);
    res.status(500).json({ detail: 'Webhook processing failed' });
  }
});

// POST /api/payments/start-trial
router.post('/start-trial', authenticateToken, async (req: Request, res: Response) => {
  try {
    const user = req.user!;

    if (user.trial_active || user.trial_end_date) {
      res.status(400).json({ detail: 'Trial already used' });
      return;
    }

    const trialEndDate = calculateTrialEndDate();

    await execute(
      `UPDATE users SET trial_active = 1, trial_end_date = @trialEndDate WHERE id = @userId`,
      { trialEndDate, userId: user.id }
    );

    res.json({
      success: true,
      trial_end_date: trialEndDate.toISOString(),
      message: 'Trial started successfully!'
    });
  } catch (error) {
    console.error('Start trial error:', error);
    res.status(500).json({ detail: 'Failed to start trial' });
  }
});

export default router;
