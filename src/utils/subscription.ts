import { SUBSCRIPTION_TIERS, FREE_TRIAL_DAYS } from '../models/types';

export function canCreateListings(
  subscriptionTier: string,
  subscriptionActive: boolean,
  trialActive: boolean
): boolean {
  if (trialActive) {
    return true;
  }
  if (!subscriptionActive) {
    return false;
  }
  const tier = SUBSCRIPTION_TIERS[subscriptionTier as keyof typeof SUBSCRIPTION_TIERS] || SUBSCRIPTION_TIERS.free;
  return tier.can_create_listings;
}

export function canRunEvaluations(
  subscriptionTier: string,
  subscriptionActive: boolean,
  trialActive: boolean
): boolean {
  if (trialActive && subscriptionTier === 'pro') {
    return true;
  }
  if (!subscriptionActive) {
    return false;
  }
  const tier = SUBSCRIPTION_TIERS[subscriptionTier as keyof typeof SUBSCRIPTION_TIERS] || SUBSCRIPTION_TIERS.free;
  return tier.can_evaluate;
}

export function calculateTrialEndDate(): Date {
  const date = new Date();
  date.setDate(date.getDate() + FREE_TRIAL_DAYS);
  return date;
}

export function isTrialActive(trialEndDate: Date | null): boolean {
  if (!trialEndDate) {
    return false;
  }
  return new Date() < new Date(trialEndDate);
}

export function isSubscriptionActive(subscriptionEndDate: Date | null): boolean {
  if (!subscriptionEndDate) {
    return false;
  }
  return new Date() < new Date(subscriptionEndDate);
}
