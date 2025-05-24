import { JsonRpcProvider, Contract, EventLog } from 'ethers';
import { EventDecoderService } from './event-decoder.service';
import { ElephantAssignment, ABI } from '../types';

export class BlockchainService {
  private provider: JsonRpcProvider;
  private contract: Contract;
  private eventDecoder: EventDecoderService;

  constructor(rpcUrl: string, contractAddress: string, abi: ABI) {
    this.provider = new JsonRpcProvider(rpcUrl);
    this.contract = new Contract(contractAddress, abi, this.provider);
    this.eventDecoder = new EventDecoderService();
  }

  public async getCurrentBlock(): Promise<number> {
    return this.provider.getBlockNumber();
  }

  public async getElephantAssignedEvents(
    elephantAddress: string,
    fromBlock: number,
    toBlock?: number
  ): Promise<ElephantAssignment[]> {
    // Define the filter for the ElephantAssigned event, filtering by the indexed elephant address
    // The event is: event ElephantAssigned(bytes propertyCid, address indexed elephant);
    // In ethers.js v6, contract.filters.EventName(arg1, arg2, ...) is used.
    // For an indexed address, you pass the address directly.
    // If an argument is not indexed or you don't want to filter by it, use null.
    const filter = this.contract.filters.ElephantAssigned(null, elephantAddress);

    const eventsRaw = await this.contract.queryFilter(filter, fromBlock, toBlock);

    // Ensure eventsRaw is an array before mapping. queryFilter should always return an array.
    if (!Array.isArray(eventsRaw)) {
        // This case should ideally not happen if queryFilter behaves as expected.
        console.error("queryFilter did not return an array:", eventsRaw);
        return [];
    }
    
    // The events returned by queryFilter are EventLog objects or similar,
    // which need to be cast or mapped to the structure EventDecoderService expects.
    // EventLog has `data` and `topics`. It also has `blockNumber` and `transactionHash`.
    const parsedEvents = eventsRaw.map(event => {
      // Make sure 'event' has the properties EventDecoderService expects.
      // Ethers v6 EventLog objects should be compatible.
      if (event instanceof EventLog) {
        return this.eventDecoder.parseElephantAssignedEvent({
          data: event.data,
          topics: [...event.topics], // Clone topics array
          blockNumber: event.blockNumber,
          transactionHash: event.transactionHash,
        });
      } else {
        // Handle cases where event might not be an EventLog instance, though unlikely with queryFilter
        // This might indicate a mocking issue in tests or an unexpected return type.
        // For now, let's assume they are EventLog or compatible.
        // If not, this could be a source of error if properties are missing.
        console.warn("Event object is not an instance of EventLog:", event);
        // Attempt to parse anyway, or throw, or return a specific error structure
        return this.eventDecoder.parseElephantAssignedEvent(event as any); 
      }
    });

    return parsedEvents;
  }
}
