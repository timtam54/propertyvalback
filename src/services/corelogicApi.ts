/**
 * CoreLogic API Integration for Australian Property Valuations
 * Professional-grade AVM (Automated Valuation Model) integration
 */

const CORELOGIC_API_BASE = 'https://api-trestle.corelogic.com';

interface PropertyAVM {
  valuation: number | null;
  lower_estimate: number | null;
  upper_estimate: number | null;
  confidence: string | null;
  valuation_date: string | null;
  property_type: string | null;
  land_area: number | null;
  building_area: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  carspaces: number | null;
}

interface ComparableSale {
  address: string;
  price: number;
  beds: number | null;
  baths: number | null;
  cars: number | null;
  sold_date: string | null;
  property_type: string;
  images: string[];
}

interface ComparablesData {
  comparable_sold: ComparableSale[];
  comparable_listings: any[];
  statistics: {
    total_found: number;
    sold_count: number;
    price_range: {
      min: number | null;
      max: number | null;
      avg: number | null;
      median: number | null;
    };
    sold_avg: number | null;
  };
  corelogic_avm?: PropertyAVM;
}

/**
 * Get OAuth 2.0 access token from CoreLogic
 */
async function getOAuthToken(clientKey: string, secretKey: string): Promise<string | null> {
  try {
    const credentials = `${clientKey}:${secretKey}`;
    const encodedCredentials = Buffer.from(credentials).toString('base64');

    const response = await fetch(`${CORELOGIC_API_BASE}/oauth/token`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${encodedCredentials}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'grant_type=client_credentials'
    });

    if (response.ok) {
      const data: any = await response.json();
      console.log('[CoreLogic] Successfully obtained OAuth token');
      return data.access_token;
    } else {
      const errorText = await response.text();
      console.error(`[CoreLogic] OAuth failed with status ${response.status}: ${errorText}`);
      return null;
    }
  } catch (error: any) {
    console.error('[CoreLogic] Error getting OAuth token:', error.message);
    return null;
  }
}

/**
 * Extract suburb and state from location string
 */
function parseLocation(location: string): { suburb: string; state: string; postcode: string } {
  const parts = location.split(',').map(p => p.trim());
  const suburb = parts[0] || '';
  let state = 'NSW';
  let postcode = '';

  if (parts.length > 1) {
    const statePart = parts[1].toUpperCase();
    for (const ausState of ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT']) {
      if (statePart.includes(ausState)) {
        state = ausState;
        break;
      }
    }
    // Try to extract postcode
    const postcodeMatch = statePart.match(/\d{4}/);
    if (postcodeMatch) {
      postcode = postcodeMatch[0];
    }
  }

  return { suburb, state, postcode };
}

/**
 * Get Automated Valuation Model (AVM) for a property from CoreLogic
 */
export async function getPropertyAVM(
  clientKey: string,
  secretKey: string,
  address: string,
  location: string
): Promise<PropertyAVM | null> {
  try {
    const accessToken = await getOAuthToken(clientKey, secretKey);
    if (!accessToken) {
      return null;
    }

    const { suburb, state, postcode } = parseLocation(location);

    const response = await fetch(`${CORELOGIC_API_BASE}/api/v1/property/avm`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        address,
        suburb,
        state,
        postcode
      })
    });

    if (response.ok) {
      const data: any = await response.json();
      console.log(`[CoreLogic] Successfully retrieved AVM for ${address}`);
      return {
        valuation: data.valuation,
        lower_estimate: data.lowerEstimate,
        upper_estimate: data.upperEstimate,
        confidence: data.confidence,
        valuation_date: data.valuationDate,
        property_type: data.propertyType,
        land_area: data.landArea,
        building_area: data.buildingArea,
        bedrooms: data.bedrooms,
        bathrooms: data.bathrooms,
        carspaces: data.carspaces
      };
    } else if (response.status === 404) {
      console.warn(`[CoreLogic] Property not found: ${address}, ${suburb}`);
      return null;
    } else {
      const errorText = await response.text();
      console.error(`[CoreLogic] AVM API returned status ${response.status}: ${errorText}`);
      return null;
    }
  } catch (error: any) {
    console.error('[CoreLogic] Error getting AVM:', error.message);
    return null;
  }
}

/**
 * Search for comparable sales using CoreLogic API
 */
export async function searchComparableSales(
  clientKey: string,
  secretKey: string,
  location: string,
  beds: number,
  baths: number,
  propertyType: string = 'House'
): Promise<ComparablesData> {
  const emptyResult: ComparablesData = {
    comparable_sold: [],
    comparable_listings: [],
    statistics: {
      total_found: 0,
      sold_count: 0,
      price_range: { min: null, max: null, avg: null, median: null },
      sold_avg: null
    }
  };

  try {
    const accessToken = await getOAuthToken(clientKey, secretKey);
    if (!accessToken) {
      return emptyResult;
    }

    const { suburb, state } = parseLocation(location);

    const response = await fetch(`${CORELOGIC_API_BASE}/api/v1/sales/search`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        suburb,
        state,
        propertyType: propertyType.charAt(0).toUpperCase() + propertyType.slice(1).toLowerCase(),
        minBedrooms: Math.max(1, beds - 1),
        maxBedrooms: beds + 1,
        minBathrooms: Math.max(1, baths - 1),
        maxBathrooms: baths + 1,
        saleType: 'Sold',
        pageSize: 10
      })
    });

    if (response.ok) {
      const data: any = await response.json();
      const sales = data.sales || [];
      const properties: ComparableSale[] = [];

      for (const sale of sales.slice(0, 10)) {
        if (sale.price) {
          const images: string[] = [];
          if (sale.images) {
            for (const img of sale.images.slice(0, 3)) {
              if (typeof img === 'string') {
                images.push(img);
              } else if (img?.url) {
                images.push(img.url);
              }
            }
          }

          properties.push({
            address: sale.address || 'Address not available',
            price: sale.price,
            beds: sale.bedrooms,
            baths: sale.bathrooms,
            cars: sale.carspaces,
            sold_date: sale.saleDate,
            property_type: propertyType,
            images
          });
        }
      }

      // Calculate statistics
      const prices = properties.map(p => p.price);
      const sortedPrices = [...prices].sort((a, b) => a - b);

      const statistics = {
        total_found: properties.length,
        sold_count: properties.length,
        price_range: {
          min: prices.length > 0 ? Math.min(...prices) : null,
          max: prices.length > 0 ? Math.max(...prices) : null,
          avg: prices.length > 0 ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : null,
          median: prices.length > 0 ? sortedPrices[Math.floor(prices.length / 2)] : null
        },
        sold_avg: prices.length > 0 ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : null
      };

      console.log(`[CoreLogic] Found ${properties.length} comparable sales in ${suburb}, ${state}`);

      return {
        comparable_sold: properties,
        comparable_listings: [],
        statistics
      };
    } else {
      const errorText = await response.text();
      console.warn(`[CoreLogic] Sales search returned status ${response.status}: ${errorText}`);
      return emptyResult;
    }
  } catch (error: any) {
    console.error('[CoreLogic] Error searching comparable sales:', error.message);
    return emptyResult;
  }
}
