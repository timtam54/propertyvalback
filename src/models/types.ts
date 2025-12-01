// User types
export interface User {
  id: string;
  email: string;
  username: string;
  hashed_password: string;
  subscription_tier: 'free' | 'basic' | 'pro';
  subscription_active: boolean;
  subscription_end_date: Date | null;
  trial_active: boolean;
  trial_end_date: Date | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  created_at: Date;
  last_login: Date | null;
  is_active: boolean;
  // OAuth fields
  auth_provider?: 'local' | 'google' | 'microsoft' | 'oauth' | null;
  picture?: string | null;
}

export interface UserSignup {
  email: string;
  username: string;
  password: string;
}

export interface UserLogin {
  email: string;
  password: string;
}

export interface TokenPayload {
  sub: string;
  email: string;
  iat?: number;
  exp?: number;
}

// Property types
export interface InclusionItem {
  text: string;
  price: number;
}

export interface Property {
  id: string;
  beds: number;
  baths: number;
  carpark: number;
  location: string;
  price?: number | null;
  size?: number | null;
  property_type?: string | null;
  features?: string | null;
  strata_body_corps?: number | null;
  council_rates?: number | null;
  images: string[];
  pitch?: string | null;
  agent1_name?: string | null;
  agent1_phone?: string | null;
  agent2_name?: string | null;
  agent2_phone?: string | null;
  agent_email?: string | null;
  evaluation_report?: string | null;
  evaluation_date?: string | null;
  improvements_detected?: string | null;
  evaluation_ad?: string | null;
  pricing_type?: string | null;
  price_upper?: number | null;
  marketing_strategy?: string | null;
  marketing_package?: string | null;
  marketing_cost?: number | null;
  marketing_report?: string | null;
  marketing_report_date?: string | null;
  rp_data_report?: string | null;
  rp_data_upload_date?: string | null;
  rp_data_filename?: string | null;
  additional_report?: string | null;
  agent_id?: string | null;
  agent_name?: string | null;
  agency_id: string;
  user_email?: string | null;
  created_at: Date;
  // Sale status fields
  status?: 'active' | 'sold' | null;
  sold_price?: number | null;
  sale_date?: string | null;
}

export interface PropertyCreate {
  beds: number;
  baths: number;
  carpark: number;
  location: string;
  price?: number | null;
  size?: number | null;
  property_type?: string | null;
  features?: string | null;
  strata_body_corps?: number | null;
  council_rates?: number | null;
  images?: string[];
  agent1_name?: string | null;
  agent1_phone?: string | null;
  agent2_name?: string | null;
  agent2_phone?: string | null;
  agent_email?: string | null;
  user_email?: string | null;
  rp_data_report?: string | null;
  additional_report?: string | null;
}

// Agent types
export interface Agent {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  agency_id: string;
  agency_name: string;
  bio?: string | null;
  specialties: string[];
  created_at: Date;
}

// Property Sale types
export interface PropertySale {
  id: string;
  address: string;
  suburb: string;
  postcode: string;
  state: string;
  property_type?: string | null;
  list_price?: number | null;
  sale_price: number;
  sale_date: string;
  beds?: number | null;
  baths?: number | null;
  carpark?: number | null;
  land_area?: number | null;
  floor_area?: number | null;
  data_source: string;
  source_state: string;
  import_date: Date;
  property_id?: string | null;
  lot_plan?: string | null;
  zone?: string | null;
}

// Marketing Package types
export interface MarketingPackage {
  id: string;
  name: string;
  price: number;
  inclusions: InclusionItem[];
  description?: string | null;
  order: number;
  active: boolean;
  created_at: Date;
}

// API Settings types
export interface APISettings {
  id: string;
  domain_api_key?: string | null;
  corelogic_client_key?: string | null;
  corelogic_secret_key?: string | null;
  realestate_api_key?: string | null;
  pricefinder_api_key?: string | null;
  google_places_api_key?: string | null;
  updated_at: Date;
}

// Market Context types
export interface MarketContext {
  id: string;
  rba_interest_rate: number;
  housing_shortage_national: number;
  housing_shortage_nsw: number;
  housing_shortage_vic: number;
  housing_shortage_qld: number;
  housing_shortage_wa: number;
  housing_shortage_sa: number;
  annual_growth_rate_min: number;
  annual_growth_rate_max: number;
  net_migration: number;
  construction_shortfall: number;
  rental_vacancy_rate: number;
  auction_clearance_rate: number;
  days_on_market: number;
  scarcity_premium_min: number;
  scarcity_premium_max: number;
  last_updated: Date;
  updated_by: string;
}

// Location Market Data types
export interface LocationMarketData {
  id: string;
  location_name: string;
  state: string;
  housing_shortage?: number | null;
  shortage_confidence: string;
  population?: number | null;
  annual_growth_rate_min?: number | null;
  annual_growth_rate_max?: number | null;
  rental_vacancy_rate?: number | null;
  auction_clearance_rate?: number | null;
  days_on_market?: number | null;
  median_price?: number | null;
  price_growth_ytd?: number | null;
  notes?: string | null;
  last_updated: Date;
}

// Subscription tiers
export const SUBSCRIPTION_TIERS = {
  free: {
    name: 'Free',
    price: 0,
    features: ['View listings'],
    can_create_listings: false,
    can_evaluate: false
  },
  basic: {
    name: 'Basic',
    price: 19.99,
    features: [
      'Create unlimited listings',
      'Upload photos',
      'Generate selling pitches',
      'Create Facebook ads'
    ],
    can_create_listings: true,
    can_evaluate: false
  },
  pro: {
    name: 'Pro',
    price: 79.99,
    features: [
      'Everything in Basic',
      'Unlimited CoreLogic evaluations',
      'PDF export',
      'Apply valuation to listing',
      'Priority support'
    ],
    can_create_listings: true,
    can_evaluate: true
  }
};

export const FREE_TRIAL_DAYS = 7;
