import { Injectable } from '@nestjs/common';
import { Scraper } from 'agent-twitter-client';

import { NotificationMessage } from '@/models/notification';

import dotenv from 'dotenv';
dotenv.config();

import * as fs from 'fs';
import * as path from 'path';

/**
 * Service for interacting with Twitter to send tweets and manage authentication
 */
@Injectable()
export class TwitterService {
  
  /** Twitter scraper instance for API interactions */
  private scraper: Scraper;
  
  constructor() {
    this.scraper = new Scraper();
  }

  /**
   * Initializes Twitter service for a specific account by loading cookies or performing fresh login
   * @param twitterAccount The account to initialize
   */
  private async initializeForAccount(twitterAccount: string): Promise<void> {
    const accountCookiesPath = path.join(process.cwd(), `${twitterAccount}-cookies.json`);
    
    try {
      // Try to load the account-specific cookies
      if (await this.loadCookies(accountCookiesPath)) {
        return;
      }

      // If no valid cookies, perform fresh login for the specific account
      console.log(`Performing fresh login for ${twitterAccount}...`);
      await this.scraper.login(
        process.env[`${twitterAccount}_USERNAME`],
        process.env[`${twitterAccount}_PASSWORD`],
        process.env[`${twitterAccount}_EMAIL`],
        process.env[`${twitterAccount}_TWO_FACTOR_SECRET`]
      );

      // Save the new cookies for the specific account
      await this.saveCookies(accountCookiesPath);
      console.log(`Successfully logged into ${twitterAccount}`);
    } catch (error) {
      console.error(`Failed to initialize Twitter service for ${twitterAccount}:`, error);
      throw error;
    }
  }

  /**
   * Loads saved cookies from file and sets them in the scraper
   * @param accountCookiesPath Path to account-specific cookies file
   * @returns True if cookies were successfully loaded, false otherwise
   */
  private async loadCookies(accountCookiesPath: string): Promise<boolean> {
    try {
      if (fs.existsSync(accountCookiesPath)) {
        const cookiesJson = fs.readFileSync(accountCookiesPath, 'utf8');
        const cookiesArray = JSON.parse(cookiesJson);

        // Format cookies as strings in the standard cookie format
        const formattedCookies = cookiesArray.map(cookie => {
          return `${cookie.key}=${cookie.value}; Domain=${cookie.domain}; Path=${cookie.path}${cookie.secure ? '; Secure' : ''}${cookie.httpOnly ? '; HttpOnly' : ''}${cookie.expires ? `; Expires=${new Date(cookie.expires).toUTCString()}` : ''}${cookie.sameSite ? `; SameSite=${cookie.sameSite}` : ''}`;
        });

        await this.scraper.setCookies(formattedCookies);
        return true;
      }
    } catch (error) {
      console.error('Error loading cookies:', error);
      return false;
    }
    return false;
  }

  /**
   * Saves current session cookies to file for a specific account
   * Only saves if essential authentication cookies are present
   * @param accountCookiesPath Path to account-specific cookies file
   */
  private async saveCookies(accountCookiesPath: string): Promise<void> {
    try {
      const cookies = await this.scraper.getCookies();
      fs.writeFileSync(accountCookiesPath, JSON.stringify(cookies, null, 2));
      console.log('Successfully saved session cookies');
    } catch (error) {
      console.error('Error saving cookies:', error);
    }
  }

  /**
   * Sends a tweet with optional image attachment from a specific Twitter account
   * If TWITTER_ENABLED is 0, skips the posting and focuses on image saving
   * @param data The tweet content and data
   * @param twitterAccount The Twitter account to send the tweet from
   * @throws Error if tweet fails to send
   */
  async sendTweet(data: NotificationMessage, twitterAccount: string): Promise<void> {
    // Skip Twitter if it's disabled (TWITTER_ENABLED=0)
    if (!Number(process.env.TWITTER_ENABLED)) {
      console.log("Twitter is disabled (TWITTER_ENABLED=0), skipping tweet and saving image locally instead.");
      return;  // Skip the Twitter posting logic
    }

    try {
      // If Twitter is enabled, proceed with the tweet logic
      await this.initializeForAccount(twitterAccount);

      const { title, message, link, imageBuffer, filename } = data;
      await this.scraper.sendTweet(
        `${title}\n\n${message}\n\n${link}`,
        undefined,
        [{ data: imageBuffer, mediaType: `image/${filename.split('.')[1]}` }]
      );
    } catch (error) {
      console.error('Failed to send tweet:', error);
      throw error;
    }
  }
}
