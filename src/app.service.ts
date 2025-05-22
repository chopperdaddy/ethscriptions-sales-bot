import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { AbiEvent, decodeEventLog, formatUnits, Log, parseAbiItem, toEventHash, toHex } from 'viem';

import { markets } from '@/constants/markets';

import { EvmService } from '@/services/evm.service';
import { DataService } from '@/services/data.service';
import { TwitterService } from '@/services/twitter.service';
import { ImageService } from '@/services/image.service';
import { CollectionService } from '@/services/collection.service';
import { UtilService } from '@/services/util.service';

import { NotificationMessage } from '@/models/notification';
import { Market, MarketplaceEvent } from '@/models/evm';

/**
 * Main service for initializing and running the application
 */
@Injectable()
export class AppService implements OnModuleInit {

  constructor(
    private readonly evmSvc: EvmService,
    private readonly dataSvc: DataService,
    private readonly twitterSvc: TwitterService,
    private readonly imageSvc: ImageService,
    private readonly collectionSvc: CollectionService,
    private readonly utilSvc: UtilService
  ) {}

  onModuleInit() {
    this.watchEvents();

    setTimeout(() => {
      // Test with history or range
      if (Number(process.env.TEST_WITH_HISTORY)) {
        this.testWithHistory();
      } else if (process.env.TEST_WITH_RANGE?.split(',').length === 2) {
        this.testWithRange();
      }
    }, 2000);
  }

  /**
   * Sets up event watchers for all configured marketplace events
   * 
   * Iterates through each marketplace and its associated events, creating event listeners
   * that will trigger when sales occur.
   */
  async watchEvents() {
    // Iterate markets
    for (const market of markets) {
      // Iterate events for each market
      for (const marketEvent of market.events) {
        // Example usage
        const eventEmitter = this.evmSvc.watchEvent(market, marketEvent);
        Logger.log(`Watching event <${marketEvent.name}> on ${market.marketplaceName}`, 'AppService');
        eventEmitter.on('event', (logs: Log[]) => {
          this.handleEvent(market, marketEvent, logs);
        });
      }
    }
  }

  /**
   * Handles marketplace events by processing sale logs and fetching inscription data
   * 
   * @param market - The marketplace where the sale occurred (e.g. Ethscriptions.com, Etch Market)
   * @param marketEvent - Details about the specific event type being handled
   * @param logs - Array of event logs containing sale data
   */
  async handleEvent(
    market: Market, 
    marketEvent: MarketplaceEvent, 
    logs: Log[]
  ) {
    // Logger.log(`New event: ${market.marketplaceName} -- ${marketEvent.name}`, 'AppService');

    if (!logs.length) return;

    const eventType = parseAbiItem(marketEvent.signature) as AbiEvent;
    const log = logs[0] as (Log<bigint, number, boolean, typeof eventType> | undefined);
    if (!log) return;

    const txHash = log.transactionHash;
    // If there is an event trigger, find the matching log
    if (marketEvent.eventTrigger) {
      // Get the transaction receipt
      const receipt = await this.evmSvc.getTransactionReceipt(txHash);
      // Find the matching log for main event
      const matchingLog = receipt.logs.find((log: Log<bigint, number, boolean, typeof eventType>) => 
        log.address.toLowerCase() === marketEvent.eventTrigger.address.toLowerCase() &&
        log.topics[0] === toEventHash(marketEvent.signature)
      );
      if (!matchingLog) return;
      // Decode the event trigger log
      const decoded = decodeEventLog({
        abi: [parseAbiItem(marketEvent.signature)],
        topics: (matchingLog as any).topics,
        data: (matchingLog as any).data,
      }) as any;
      // Combine the main event log and the event trigger log
      log.args = { ...log.args, ...decoded.args };
    }
    
    // Ordex returns the hashId as a uint256 (👎)
    let hashId = log.args[marketEvent.hashIdTarget];
    if (typeof hashId === 'bigint') {
      hashId = toHex(hashId);
      // Ensure hashId is bytes32 (32 bytes = 64 hex chars + '0x' prefix = 66 chars)
      if (hashId.length < 66) {
        hashId = hashId.replace('0x', '0x' + '0'.repeat(66 - hashId.length));
      }
    }
    const value = formatUnits(log.args[marketEvent.valueTarget], 18);
    const seller = log.args[marketEvent.sellerTarget];
    const buyer = log.args[marketEvent.buyerTarget];

    // Check if it's supported
    const collectionMetadata = this.collectionSvc.getSupportedInscription(hashId);
    if (!collectionMetadata) return;

    // Get the collection image
    if (collectionMetadata.collectionImageHash) {
      const collectionImage = await this.evmSvc.getInscriptionImageFromHashId(collectionMetadata.collectionImageHash);
      if (collectionImage) collectionMetadata.collectionImageUri = collectionImage;
    }

    Logger.log(`New event from supported collection: ${collectionMetadata.collectionName}`, 'AppService');

    // Get the inscription data
    const inscriptionImageUri = await this.evmSvc.getInscriptionImageFromHashId(hashId);
    if (!inscriptionImageUri) return;

    // Generate the image
    const imageAttachment = await this.imageSvc.generate(hashId, value, txHash, inscriptionImageUri, collectionMetadata);

    const [buyerEns, sellerEns] = await Promise.all([
      this.evmSvc.getEnsName(buyer),
      this.evmSvc.getEnsName(seller),
    ]);

    // Create the notification message
    const notificationMessage: NotificationMessage = {
      title: `${collectionMetadata.itemName} was sold`,
      message: `From: ${sellerEns || this.utilSvc.formatAddress(seller)}\nTo: ${buyerEns || this.utilSvc.formatAddress(buyer)}\n\nFor: ${value} ETH ($${this.utilSvc.formatCash(Number(value) * this.dataSvc.usdPrice)})`,
      link: `https://etherscan.io/tx/${txHash}`,
      imageBuffer: imageAttachment,
      filename: `${hashId}.png`,
    };

    // Post to twitter
    const twitterAccount = collectionMetadata.twitterAccount; // Retrieve the Twitter account
    if (!twitterAccount) {
      Logger.error(`No Twitter account configured for collection: ${collectionMetadata.collectionName}`, 'AppService');
      return;
    }
    await this.twitterSvc.sendTweet(notificationMessage, twitterAccount);

    // Save the image
    if (Number(process.env.SAVE_IMAGES)) {
      await this.imageSvc.saveImage(collectionMetadata.collectionName, hashId, imageAttachment);
    }
  }

  /**
   * Test method that processes historical events from all configured markets
   * Used for testing event handling with past events rather than live events
   * 
   * Iterates through all markets and their events, processing all historical events found
   * This allows testing the full event handling pipeline with real past data
   */
  async testWithHistory() {
    Logger.log(`Testing with history: ${process.env.TEST_WITH_HISTORY}`, 'AppService');
    // Iterate markets
    for (const market of markets) {
      // Iterate events for each market
      for (const marketEvent of market.events) {
        // Example usage
        const saleLogs = await this.evmSvc.indexPreviousEvents(
          market, 
          marketEvent, 
          Number(process.env.TEST_WITH_HISTORY)
        );
        for (const log of saleLogs) {
          await this.handleEvent(market, marketEvent, [log]);
        }
      }
    }
  }

  /**
   * Test method that processes historical events from all configured markets
   * Used for testing event handling with past events rather than live events
   * 
   * Iterates through all markets and their events, processing all historical events found
   * This allows testing the full event handling pipeline with real past data
   */
  async testWithRange() {
    Logger.log(`Testing with range: ${process.env.TEST_WITH_RANGE}`, 'AppService');
    // Iterate markets
    for (const market of markets) {
      // Iterate events for each market
      for (const marketEvent of market.events) {
        // Example usage
        const saleLogs = await this.evmSvc.indexPreviousEvents(
          market, 
          marketEvent, 
          {
            startBlock: Number(process.env.TEST_WITH_RANGE.split(',')[0]),
            endBlock: Number(process.env.TEST_WITH_RANGE.split(',')[1])
          }
        );
        for (const log of saleLogs) {
          await this.handleEvent(market, marketEvent, [log]);
        }
      }
    }
  }
}
