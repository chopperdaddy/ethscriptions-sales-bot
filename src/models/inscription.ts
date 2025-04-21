export interface EthscriptionTransfer {
  id: string;
  ethscription_transaction_hash: string;
  transaction_hash: string;
  from_address: string;
  to_address: string;
  block_number: string;
  block_timestamp: string;
  block_blockhash: string;
  event_log_index: string | null;
  transfer_index: string;
  transaction_index: string;
  enforced_previous_owner: string | null;
  created_at: string;
  updated_at: string;
}

export interface InscriptionAPIResponse {
  id: string;
  transaction_hash: string;
  block_number: string;
  transaction_index: string;
  block_timestamp: string;
  block_blockhash: string;
  event_log_index: null;
  ethscription_number: string;
  creator: string;
  initial_owner: string;
  current_owner: string;
  previous_owner: string;
  content_uri: string;
  content_sha: string;
  esip6: boolean;
  mimetype: string;
  media_type: string;
  mime_subtype: string;
  gas_price: string;
  gas_used: string;
  transaction_fee: string;
  value: string;
  created_at: string;
  updated_at: string;
  ethscription_transfers: EthscriptionTransfer[];
}

export interface InscriptionMetadata {
  collectionName: string;
  collectionImageHash: `0x${string}`;
  itemName: string;
  backgroundColor: string;
  websiteLink: string;
  collectionImageUri?: string | null | undefined;
  twitterAccount?: string;
}
