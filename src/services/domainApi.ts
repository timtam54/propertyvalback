/**
 * Domain API Integration for Australian Property Data
 * Uses the official Domain API for comparable property data
 */

const DOMAIN_API_BASE = 'https://api.domain.com.au';

interface PropertyDetails {
  address: string;
  price: number | null;
  beds: number | null;
  baths: number | null;
  cars: number | null;
  property_type: string;
  sold_date?: string;
  listing_type?: string;
  images?: string[];
}

interface ComparablesData {
  comparable_sold: PropertyDetails[];
  comparable_listings: PropertyDetails[];
  statistics: {
    total_found: number;
    sold_count: number;
    listing_count: number;
    price_range: {
      min: number | null;
      max: number | null;
      avg: number | null;
      median: number | null;
    };
    sold_avg: number | null;
    listing_avg: number | null;
  };
}

/**
 * Extract state from location string
 */
function extractState(location: string): string {
  const states = ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT'];
  const upperLocation = location.toUpperCase();

  for (const state of states) {
    if (upperLocation.includes(state)) {
      return state;
    }
  }

  return 'NSW'; // Default
}

/**
 * Extract suburb from location string
 */
function extractSuburb(location: string): string {
  // Get the first part before comma
  const parts = location.split(',');
  return parts[0].trim();
}

/**
 * Search for sold properties using Domain API
 */
export async function searchSoldProperties(
  apiKey: string,
  location: string,
  beds: number,
  baths: number,
  propertyType: string = 'House'
): Promise<PropertyDetails[]> {
  try {
    const suburb = extractSuburb(location);
    const state = extractState(location);

    const headers = {
      'X-API-Key': apiKey,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };

    const url = `${DOMAIN_API_BASE}/v1/listings/residential/_search`;

    const searchBody = {
      listingType: 'Sale',
      propertyTypes: [propertyType],
      minBedrooms: Math.max(1, beds - 1),
      maxBedrooms: beds + 1,
      minBathrooms: Math.max(1, baths - 1),
      maxBathrooms: baths + 1,
      locations: [
        {
          state: state,
          suburb: suburb,
          includeSurroundingSuburbs: true
        }
      ],
      pageSize: 10
    };

    console.log(`[Domain API] Searching for properties in ${suburb}, ${state}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(searchBody),
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (!response.ok) {
        console.error(`[Domain API] HTTP error: ${response.status}`);
        return [];
      }

      const data = await response.json();
      var listings = Array.isArray(data) ? data : [];
    } catch (e) {
      clearTimeout(timeout);
      throw e;
    }
    const properties: PropertyDetails[] = [];

    for (const listing of listings.slice(0, 10)) {
      try {
        const propData: PropertyDetails = {
          address: listing.headline || 'Address not available',
          price: null,
          beds: null,
          baths: null,
          cars: null,
          property_type: propertyType,
          images: []
        };

        // Extract price
        if (listing.priceDetails?.displayPrice) {
          const priceMatch = listing.priceDetails.displayPrice.match(/\$[\d,]+/);
          if (priceMatch) {
            const priceText = priceMatch[0].replace('$', '').replace(/,/g, '');
            propData.price = parseInt(priceText);
          }
        }

        // Extract property features
        if (listing.propertyDetails) {
          propData.beds = listing.propertyDetails.bedrooms;
          propData.baths = listing.propertyDetails.bathrooms;
          propData.cars = listing.propertyDetails.carspaces;
        }

        // Extract sold date if available
        if (listing.saleDetails?.soldDate) {
          propData.sold_date = listing.saleDetails.soldDate;
        } else {
          propData.sold_date = 'Recently';
        }

        // Extract images
        if (listing.media) {
          for (const media of listing.media.slice(0, 3)) {
            if (media.category === 'Image' && media.url) {
              propData.images?.push(media.url);
            }
          }
        }

        if (propData.price) {
          properties.push(propData);
        }
      } catch (e) {
        console.error('[Domain API] Error parsing listing:', e);
      }
    }

    console.log(`[Domain API] Found ${properties.length} comparable properties in ${suburb}, ${state}`);
    return properties;

  } catch (error: any) {
    console.error('[Domain API] Error searching sold properties:', error.message);
    return [];
  }
}

/**
 * Get comparable properties using Domain API
 * Main function for getting market data
 */
export async function getComparableProperties(
  apiKey: string,
  location: string,
  beds: number,
  baths: number,
  propertyType: string = 'House'
): Promise<ComparablesData> {
  try {
    // Search for sold properties
    const soldProperties = await searchSoldProperties(apiKey, location, beds, baths, propertyType);

    // Calculate statistics
    const prices = soldProperties.filter(p => p.price).map(p => p.price as number);

    const sortedPrices = [...prices].sort((a, b) => a - b);
    const medianPrice = sortedPrices.length > 0
      ? sortedPrices[Math.floor(sortedPrices.length / 2)]
      : null;

    const statistics = {
      total_found: soldProperties.length,
      sold_count: soldProperties.length,
      listing_count: 0,
      price_range: {
        min: prices.length > 0 ? Math.min(...prices) : null,
        max: prices.length > 0 ? Math.max(...prices) : null,
        avg: prices.length > 0 ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : null,
        median: medianPrice
      },
      sold_avg: prices.length > 0 ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : null,
      listing_avg: null
    };

    return {
      comparable_sold: soldProperties,
      comparable_listings: [],
      statistics
    };

  } catch (error: any) {
    console.error('[Domain API] Error getting comparable properties:', error.message);
    return {
      comparable_sold: [],
      comparable_listings: [],
      statistics: {
        total_found: 0,
        sold_count: 0,
        listing_count: 0,
        price_range: { min: null, max: null, avg: null, median: null },
        sold_avg: null,
        listing_avg: null
      }
    };
  }
}
