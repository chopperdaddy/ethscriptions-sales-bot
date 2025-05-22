import { Injectable, OnModuleInit, Logger } from '@nestjs/common';

import { UtilService } from '@/services/util.service';

import { collections } from '@/constants/collections';

import { JSONCollection } from '@/models/collection';
import { InscriptionMetadata } from '@/models/inscription';

/**
 * Service for managing Ethscription collection data and metadata
 */
@Injectable()
export class CollectionService implements OnModuleInit {
  
  /**
   * In-memory cache mapping inscription hash IDs to collection metadata
   * Key format: inscription:<lowercase_hash_id>
   */
  memoryCache: Map<string, InscriptionMetadata> = new Map();

  constructor(private readonly utilSvc: UtilService) {}

  /**
   * Loads supported collection data when service initializes
   */
  async onModuleInit() {
    await this.loadSupportedCollections();
  }

  /**
   * Looks up collection metadata for a given inscription hash ID
   * 
   * @param hashId - The Ethscription hash ID to look up
   * @returns Collection metadata object if inscription is from a supported collection, undefined otherwise
   */
  getSupportedInscription(hashId: string): InscriptionMetadata | undefined {
    if (!hashId) return;
  
    const cacheKey = `inscription:${hashId.toLowerCase()}`;
    return this.memoryCache.get(cacheKey);
  }

  /**
   * Loads and caches metadata for all configured collections
   * @throws Error if collection data cannot be fetched or parsed
   */
  async loadSupportedCollections() {
    try {
      for (const collection of collections) {
        const response = await fetch(collection.metadataUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch collection: ${collection}`);
        }

        // TODO: Fix this
        // Currently supports standard metadata, etherphunk market metadata, and emblem vault metadata
        const data = await response.json() as JSONCollection | any;

        const collectionName = data.name;
        const collectionImageHash = this.utilSvc.extractHex(data.logo_image_uri || data.inscription_icon);
        const backgroundColor = data.background_color;
        const websiteLink = data.website_link || data.website_url;
        const twitterAccount = collection.twitterAccount; // Extract the Twitter account

        for (const item of (data.collection_items || (data as any).inscriptions)) {
          const hashId = item.ethscription_id?.toLowerCase() || item.id?.toLowerCase();
          if (hashId) {
            const cacheKey = `inscription:${hashId}`;
            const cacheData = {
              collectionName,
              collectionImageHash,
              itemName: item.name || item.meta.name,
              backgroundColor,
              websiteLink,
              collectionImageUri: data.logo_image_uri || data.inscription_icon || data.logo_image,
              twitterAccount, // Add the Twitter account to the cache
            };
            this.memoryCache.set(cacheKey, cacheData);
          }
        }

        Logger.log(`Loaded ${data.name} collection`, 'CollectionService');
      }
    } catch (error) {
      console.error('Failed to load collections:', error);
      throw error;
    }
  }
}
