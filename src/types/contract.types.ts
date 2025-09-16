export interface DataItem {
  propertyCid: string;
  dataGroupCID: string;
  dataCID: string;
}

export interface ContractMethods {
  getCurrentFieldDataCID(
    propertyCid: string,
    dataGroupCID: string
  ): Promise<string>;

  getParticipantsForConsensusDataCID(
    propertyCid: string,
    dataGroupCID: string,
    dataCID: string
  ): Promise<string[]>;

  submitBatchData(items: DataItem[]): Promise<void>;
}

export interface GetCurrentFieldDataCIDCall {
  propertyCid: string;
  dataGroupCID: string;
}

export interface GetParticipantsCall {
  propertyCid: string;
  dataGroupCID: string;
  dataCID: string;
}

export interface BatchSubmissionResult {
  transactionHash: string;
  blockNumber?: number;
  gasUsed?: string;
  itemsSubmitted: number;
}
