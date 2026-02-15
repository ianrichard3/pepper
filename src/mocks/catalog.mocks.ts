import type {
  ApiCatalogItemDetails,
  ApiCatalogSearchResponse,
  ApiCatalogStatusResponse,
} from '@/lib/api'

export const mockCatalogStatusAvailable: ApiCatalogStatusResponse = {
  enabled: true,
  providers: [
    {
      provider: 'EBAY',
      available: true,
      reason: null,
    },
  ],
}

export const mockCatalogStatusUnavailable: ApiCatalogStatusResponse = {
  enabled: true,
  providers: [
    {
      provider: 'EBAY',
      available: false,
      reason: 'missing eBay credentials',
    },
  ],
}

export const mockCatalogSearchResponse: ApiCatalogSearchResponse = {
  items: [
    {
      provider: 'EBAY',
      external_id: 'v1|123456789012|0',
      title: 'Focusrite Scarlett 2i2 3rd Gen USB Audio Interface',
      thumbnail: 'https://i.ebayimg.com/images/g/abc/s-l1600.jpg',
      brand: 'Focusrite',
      model: 'Scarlett 2i2',
      short_specs: ['Used', '129.99 USD'],
      source_url: 'https://www.ebay.com/itm/123456789012',
    },
    {
      provider: 'EBAY',
      external_id: 'v1|987654321000|0',
      title: 'Universal Audio Volt 2 USB Audio Interface',
      thumbnail: 'https://i.ebayimg.com/images/g/def/s-l1600.jpg',
      brand: 'Universal Audio',
      model: 'Volt 2',
      short_specs: ['New', '179.00 USD'],
      source_url: 'https://www.ebay.com/itm/987654321000',
    },
  ],
  page_info: {
    page: 1,
    page_size: 20,
    total: 243,
    next_page_token: '20',
  },
}

export const mockCatalogItemDetailsByExternalId: Record<string, ApiCatalogItemDetails> = {
  'v1|123456789012|0': {
    provider: 'EBAY',
    external_id: 'v1|123456789012|0',
    title: 'Focusrite Scarlett 2i2 3rd Gen USB Audio Interface',
    images: [
      'https://i.ebayimg.com/images/g/abc/s-l1600.jpg',
      'https://i.ebayimg.com/images/g/ghi/s-l1600.jpg',
    ],
    brand: 'Focusrite',
    model: 'Scarlett 2i2',
    category_path: 'Pro Audio Equipment > Audio/MIDI Interfaces',
    category_id: '12345',
    identifiers: {
      mpn: 'MOSC0025',
      upc: '815301005784',
    },
    specs: {
      Condition: 'Used',
      Connectivity: 'USB',
      'Number of Inputs': '2',
      'Number of Outputs': '2',
      'Phantom Power': 'Yes',
    },
    source_url: 'https://www.ebay.com/itm/123456789012',
    attribution: 'Data provided by eBay Browse API',
  },
  'v1|987654321000|0': {
    provider: 'EBAY',
    external_id: 'v1|987654321000|0',
    title: 'Universal Audio Volt 2 USB Audio Interface',
    images: [
      'https://i.ebayimg.com/images/g/def/s-l1600.jpg',
      'https://i.ebayimg.com/images/g/jkl/s-l1600.jpg',
    ],
    brand: 'Universal Audio',
    model: 'Volt 2',
    category_path: 'Pro Audio Equipment > Audio/MIDI Interfaces',
    category_id: '12345',
    identifiers: {
      mpn: 'VOLT2-US',
    },
    specs: {
      Condition: 'New',
      Connectivity: 'USB-C',
      'Number of Inputs': '2',
      'Number of Outputs': '2',
      'Phantom Power': 'Yes',
    },
    source_url: 'https://www.ebay.com/itm/987654321000',
    attribution: 'Data provided by eBay Browse API',
  },
}

export function getMockCatalogItemDetails(externalId: string): ApiCatalogItemDetails {
  return (
    mockCatalogItemDetailsByExternalId[externalId] ||
    {
      provider: 'EBAY',
      external_id: externalId,
      title: 'Unknown catalog item',
      images: [],
      identifiers: {},
      specs: {},
      attribution: 'Data provided by eBay Browse API',
    }
  )
}
