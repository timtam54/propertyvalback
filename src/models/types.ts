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
  // Admin flag
  admin?: boolean | null;
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

// Property Image type (separate collection for property-image relationship)
export interface PropertyImage {
  id: string;
  property_id: string;
  image_url: string;
  order: number;  // For maintaining image order
  created_at: Date;
}

// Property types
export interface InclusionItem {
  text: string;
  price: number;
}

// Historical valuation entry
export interface ValuationHistoryEntry {
  date: string;
  estimated_value: number;
  value_low: number;
  value_high: number;
  confidence_score: number;
  confidence_level: 'high' | 'medium' | 'low';
  data_source: string;
  comparables_count: number;
  notes?: string;
}

// Confidence scoring breakdown
export interface ConfidenceScoring {
  overall_score: number;
  level: 'high' | 'medium' | 'low';
  factors: {
    comparables_count: { score: number; weight: number; description: string };
    data_recency: { score: number; weight: number; description: string };
    location_match: { score: number; weight: number; description: string };
    property_similarity: { score: number; weight: number; description: string };
    price_consistency: { score: number; weight: number; description: string };
  };
  recommendations: string[];
}

// Comparable property
export interface ComparableProperty {
  id: string;
  address: string;
  price: number;
  beds: number | null;
  baths: number | null;
  carpark: number | null;
  property_type: string;
  sold_date?: string;
  distance_km?: number;
  similarity_score?: number;
  source?: string;
  selected?: boolean;
  land_size?: number | null;
  building_size?: number | null;
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
  // Geolocation
  latitude?: number | null;
  longitude?: number | null;
  // Valuation quality fields
  valuation_history?: ValuationHistoryEntry[];
  confidence_scoring?: ConfidenceScoring | null;
  comparables_data?: {
    comparable_sold: ComparableProperty[];
    best_match?: ComparableProperty | null;
    exact_matches_count?: number;
    valuation_basis?: string;
    statistics: {
      total_found: number;
      sold_count: number;
      price_range: {
        min: number | null;
        max: number | null;
        avg: number | null;
        median: number | null;
      };
      exact_match_avg?: number | null;
    };
    data_source?: string;
    domain_api_error?: string | null;
  } | null;
  selected_comparables?: string[];
  is_favourite?: boolean;
  tags?: string[] | null;
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

// Historic Sales Matching Weights
// These weights control how comparable properties are scored against the target property
export interface HistoricSalesWeights {
  id: string;
  name: string; // e.g., 'default', 'custom_v1'
  description?: string;

  // Bedroom matching
  bedroom_exact_match_bonus: number;      // Bonus when bedrooms match exactly (default: 0)
  bedroom_diff_penalty_per_bed: number;   // Penalty per bedroom difference (default: 25)

  // Bathroom matching
  bathroom_exact_match_bonus: number;     // Bonus when bathrooms match exactly (default: 0)
  bathroom_diff_penalty_per_bath: number; // Penalty per bathroom difference (default: 20)

  // Property type / density matching
  density_house_to_unit_penalty: number;        // Penalty for house vs unit mismatch (default: 40)
  density_house_to_subdivision_penalty: number; // Penalty for house vs townhouse/villa mismatch (default: 20)

  // Distance-based adjustments (in km)
  distance_ultra_close_bonus: number;     // Bonus for < 200m (default: 40)
  distance_ultra_close_threshold_km: number;
  distance_very_close_bonus: number;      // Bonus for 200-350m (default: 30)
  distance_very_close_threshold_km: number;
  distance_close_bonus: number;           // Bonus for 350-500m (default: 15)
  distance_close_threshold_km: number;
  distance_moderate_penalty: number;      // Penalty for 500m-1km (default: 8)
  distance_moderate_threshold_km: number;
  distance_far_penalty: number;           // Penalty for 1-2km (default: 15)
  distance_far_threshold_km: number;
  distance_very_far_penalty: number;      // Penalty for > 5km (default: 25)
  distance_very_far_threshold_km: number;

  // Recency-based adjustments (in months)
  recency_very_recent_bonus: number;      // Bonus for 0-3 months (default: 10)
  recency_very_recent_threshold_months: number;
  recency_recent_bonus: number;           // Bonus for 3-6 months (default: 5)
  recency_recent_threshold_months: number;
  recency_getting_old_penalty: number;    // Penalty for 12-18 months (default: 5)
  recency_getting_old_threshold_months: number;
  recency_old_penalty: number;            // Penalty for 18-24 months (default: 10)
  recency_old_threshold_months: number;
  recency_very_old_penalty: number;       // Penalty for > 24 months (default: 20)
  recency_very_old_threshold_months: number;

  // Land area matching (future use)
  land_area_weight: number;               // Weight for land area similarity (0-1, default: 0)
  land_area_tolerance_percent: number;    // Acceptable variance % (default: 20)

  // Metadata
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  created_by?: string;
}

// Default weights - matches current hardcoded values in HistoricSalesCard.tsx
export const DEFAULT_HISTORIC_SALES_WEIGHTS: Omit<HistoricSalesWeights, 'id' | 'created_at' | 'updated_at'> = {
  name: 'default',
  description: 'Default matching weights based on original algorithm',

  bedroom_exact_match_bonus: 0,
  bedroom_diff_penalty_per_bed: 25,

  bathroom_exact_match_bonus: 0,
  bathroom_diff_penalty_per_bath: 20,

  density_house_to_unit_penalty: 40,
  density_house_to_subdivision_penalty: 20,

  distance_ultra_close_bonus: 40,
  distance_ultra_close_threshold_km: 0.2,
  distance_very_close_bonus: 30,
  distance_very_close_threshold_km: 0.35,
  distance_close_bonus: 15,
  distance_close_threshold_km: 0.5,
  distance_moderate_penalty: 8,
  distance_moderate_threshold_km: 1,
  distance_far_penalty: 15,
  distance_far_threshold_km: 2,
  distance_very_far_penalty: 25,
  distance_very_far_threshold_km: 5,

  recency_very_recent_bonus: 10,
  recency_very_recent_threshold_months: 3,
  recency_recent_bonus: 5,
  recency_recent_threshold_months: 6,
  recency_getting_old_penalty: 5,
  recency_getting_old_threshold_months: 12,
  recency_old_penalty: 10,
  recency_old_threshold_months: 18,
  recency_very_old_penalty: 20,
  recency_very_old_threshold_months: 24,

  land_area_weight: 0,
  land_area_tolerance_percent: 20,

  is_active: true,
  created_by: 'system'
};
