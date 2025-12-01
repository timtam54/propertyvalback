/**
 * Web scraper for Australian property data
 * Scrapes realestate.com.au for current listings and sold properties
 */

interface ScrapedProperty {
  address: string;
  price: number | null;
  beds: number | null;
  baths: number | null;
  cars: number | null;
  property_type: string;
  listing_type: string;
  sold_date?: string;
  source: string;
}

interface ComparablesData {
  comparable_sold: ScrapedProperty[];
  comparable_listings: ScrapedProperty[];
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
 * Parse location to get suburb and state
 */
function parseLocation(location: string): { suburb: string; state: string } {
  const parts = location.split(',').map(p => p.trim());
  const suburb = parts[0].toLowerCase().replace(/\s+/g, '-');
  let state = 'nsw';

  if (parts.length > 1) {
    const statePart = parts[1].toLowerCase();
    for (const ausState of ['nsw', 'vic', 'qld', 'sa', 'wa', 'tas', 'nt', 'act']) {
      if (statePart.includes(ausState)) {
        state = ausState;
        break;
      }
    }
  }

  return { suburb, state };
}

/**
 * Extract price from text string
 */
function extractPrice(priceText: string): number | null {
  if (!priceText) return null;

  // Remove common text and whitespace
  const cleaned = priceText.replace(/[$,\s]/g, '');

  // Try to find a price (6+ digits for Australian property prices)
  const match = cleaned.match(/(\d{6,})/);
  if (match) {
    return parseInt(match[1]);
  }

  // Try smaller numbers with multiplier (e.g., "1.2m" or "850k")
  const millionMatch = priceText.toLowerCase().match(/([\d.]+)\s*m/);
  if (millionMatch) {
    return Math.round(parseFloat(millionMatch[1]) * 1000000);
  }

  const thousandMatch = priceText.toLowerCase().match(/([\d.]+)\s*k/);
  if (thousandMatch) {
    return Math.round(parseFloat(thousandMatch[1]) * 1000);
  }

  return null;
}

/**
 * Scrape current listings from realestate.com.au
 */
export async function scrapeRealestateListings(
  location: string,
  beds: number,
  baths: number,
  propertyType: string = 'house'
): Promise<ScrapedProperty[]> {
  try {
    const { suburb, state } = parseLocation(location);

    // Build URL for buy listings
    const url = `https://www.realestate.com.au/buy/property-${propertyType}-with-${beds}-bedrooms-in-${suburb},+${state}/list-1`;

    console.log(`[Scraper] Fetching listings from: ${url}`);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.realestate.com.au/'
      }
    });

    if (!response.ok) {
      console.warn(`[Scraper] Realestate.com.au returned status ${response.status}`);
      return [];
    }

    const html = await response.text();
    const properties: ScrapedProperty[] = [];

    // Parse using regex patterns (since we can't use DOM parser in serverless)
    // Look for JSON-LD structured data which realestate.com.au includes
    const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g);

    if (jsonLdMatch) {
      for (const match of jsonLdMatch) {
        try {
          const jsonStr = match.replace(/<script type="application\/ld\+json">/, '').replace(/<\/script>/, '');
          const data = JSON.parse(jsonStr);

          if (data['@type'] === 'ItemList' && data.itemListElement) {
            for (const item of data.itemListElement.slice(0, 10)) {
              if (item.item && item.item['@type'] === 'Residence') {
                const prop = item.item;
                const price = extractPrice(prop.offers?.price || prop.offers?.priceRange || '');

                if (price) {
                  properties.push({
                    address: prop.address?.streetAddress || prop.name || 'Address not available',
                    price,
                    beds: prop.numberOfRooms || beds,
                    baths: baths,
                    cars: null,
                    property_type: propertyType,
                    listing_type: 'For Sale',
                    source: 'Realestate.com.au'
                  });
                }
              }
            }
          }
        } catch (e) {
          // Continue if JSON parsing fails
        }
      }
    }

    // Fallback: Parse listing cards using regex
    if (properties.length === 0) {
      // Match price patterns
      const priceMatches = html.matchAll(/\$[\d,]+(?:,\d{3})*(?:\s*-\s*\$[\d,]+)?/g);
      const addressMatches = html.matchAll(/data-testid="address"[^>]*>([^<]+)</g);

      const prices = Array.from(priceMatches).map(m => extractPrice(m[0])).filter(p => p !== null);
      const addresses = Array.from(addressMatches).map(m => m[1].trim());

      // Combine prices and addresses
      const count = Math.min(prices.length, addresses.length, 10);
      for (let i = 0; i < count; i++) {
        if (prices[i]) {
          properties.push({
            address: addresses[i] || `Property ${i + 1} in ${suburb}`,
            price: prices[i],
            beds: beds,
            baths: baths,
            cars: null,
            property_type: propertyType,
            listing_type: 'For Sale',
            source: 'Realestate.com.au'
          });
        }
      }
    }

    console.log(`[Scraper] Found ${properties.length} listings from Realestate.com.au`);
    return properties;

  } catch (error: any) {
    console.error('[Scraper] Error scraping Realestate.com.au listings:', error.message);
    return [];
  }
}

/**
 * Scrape sold properties from realestate.com.au
 */
export async function scrapeRealestateSold(
  location: string,
  beds: number,
  baths: number,
  propertyType: string = 'house'
): Promise<ScrapedProperty[]> {
  try {
    const { suburb, state } = parseLocation(location);

    // Build URL for sold properties
    const url = `https://www.realestate.com.au/sold/property-${propertyType}-with-${beds}-bedrooms-in-${suburb},+${state}/list-1`;

    console.log(`[Scraper] Fetching sold properties from: ${url}`);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.realestate.com.au/'
      }
    });

    if (!response.ok) {
      console.warn(`[Scraper] Realestate.com.au sold returned status ${response.status}`);
      return [];
    }

    const html = await response.text();
    const properties: ScrapedProperty[] = [];

    // Parse JSON-LD structured data
    const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g);

    if (jsonLdMatch) {
      for (const match of jsonLdMatch) {
        try {
          const jsonStr = match.replace(/<script type="application\/ld\+json">/, '').replace(/<\/script>/, '');
          const data = JSON.parse(jsonStr);

          if (data['@type'] === 'ItemList' && data.itemListElement) {
            for (const item of data.itemListElement.slice(0, 10)) {
              if (item.item) {
                const prop = item.item;
                const price = extractPrice(prop.offers?.price || '');

                if (price) {
                  properties.push({
                    address: prop.address?.streetAddress || prop.name || 'Address not available',
                    price,
                    beds: prop.numberOfRooms || beds,
                    baths: baths,
                    cars: null,
                    property_type: propertyType,
                    listing_type: 'Sold',
                    sold_date: 'Recently',
                    source: 'Realestate.com.au'
                  });
                }
              }
            }
          }
        } catch (e) {
          // Continue if JSON parsing fails
        }
      }
    }

    // Fallback regex parsing
    if (properties.length === 0) {
      const priceMatches = html.matchAll(/Sold[^$]*\$[\d,]+/gi);

      for (const match of Array.from(priceMatches).slice(0, 10)) {
        const price = extractPrice(match[0]);
        if (price && price > 100000) {
          properties.push({
            address: `Property in ${suburb.replace(/-/g, ' ')}`,
            price,
            beds: beds,
            baths: baths,
            cars: null,
            property_type: propertyType,
            listing_type: 'Sold',
            sold_date: 'Recently',
            source: 'Realestate.com.au'
          });
        }
      }
    }

    console.log(`[Scraper] Found ${properties.length} sold properties from Realestate.com.au`);
    return properties;

  } catch (error: any) {
    console.error('[Scraper] Error scraping Realestate.com.au sold:', error.message);
    return [];
  }
}

/**
 * Get comparable properties from web scraping
 * Combines listings and sold data from Realestate.com.au
 */
export async function scrapeComparableProperties(
  location: string,
  beds: number,
  baths: number,
  propertyType: string = 'house'
): Promise<ComparablesData> {
  try {
    // Run both scrapers concurrently
    const [listings, sold] = await Promise.all([
      scrapeRealestateListings(location, beds, baths, propertyType),
      scrapeRealestateSold(location, beds, baths, propertyType)
    ]);

    // Filter properties with similar specs (±1 bed, ±1 bath)
    const filterSimilar = (props: ScrapedProperty[]) =>
      props.filter(p =>
        p.beds !== null && Math.abs(p.beds - beds) <= 1 &&
        (p.baths === null || Math.abs(p.baths - baths) <= 1)
      );

    const similarListings = filterSimilar(listings);
    const similarSold = filterSimilar(sold);

    // Calculate statistics
    const allPrices = [...similarListings, ...similarSold]
      .filter(p => p.price !== null)
      .map(p => p.price as number);

    const soldPrices = similarSold
      .filter(p => p.price !== null)
      .map(p => p.price as number);

    const listingPrices = similarListings
      .filter(p => p.price !== null)
      .map(p => p.price as number);

    const sortedPrices = [...allPrices].sort((a, b) => a - b);

    const statistics = {
      total_found: allPrices.length,
      sold_count: soldPrices.length,
      listing_count: listingPrices.length,
      price_range: {
        min: allPrices.length > 0 ? Math.min(...allPrices) : null,
        max: allPrices.length > 0 ? Math.max(...allPrices) : null,
        avg: allPrices.length > 0 ? Math.round(allPrices.reduce((a, b) => a + b, 0) / allPrices.length) : null,
        median: sortedPrices.length > 0 ? sortedPrices[Math.floor(sortedPrices.length / 2)] : null
      },
      sold_avg: soldPrices.length > 0 ? Math.round(soldPrices.reduce((a, b) => a + b, 0) / soldPrices.length) : null,
      listing_avg: listingPrices.length > 0 ? Math.round(listingPrices.reduce((a, b) => a + b, 0) / listingPrices.length) : null
    };

    console.log(`[Scraper] Aggregated ${allPrices.length} comparable properties`);

    return {
      comparable_sold: similarSold.slice(0, 5),
      comparable_listings: similarListings.slice(0, 5),
      statistics
    };

  } catch (error: any) {
    console.error('[Scraper] Error getting comparable properties:', error.message);
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
