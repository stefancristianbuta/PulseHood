import {
  decodeEventLog,
  decodeFunctionData,
  type Abi,
  type Hex,
} from 'viem';

export interface TransactionEnvelope {
  hash: Hex;
  from: `0x${string}`;
  to: `0x${string}` | null;
  input: Hex;
  value: bigint;
  blockNumber: bigint;
  blockTimestamp: bigint;
}

export interface AbiRegistration {
  address: `0x${string}`;
  protocol: string;
  abi: Abi;
}

export interface DecodedTransaction {
  status: 'decoded' | 'unknown' | 'invalid';
  hash: Hex;
  to: `0x${string}` | null;
  protocol?: string;
  functionName?: string;
  args?: readonly unknown[];
  reason?: string;
}

export interface LogEnvelope {
  address: `0x${string}`;
  data: Hex;
  topics: readonly Hex[];
  blockNumber: bigint;
  transactionHash: Hex;
  logIndex: number;
}

export interface DecodedEvent {
  status: 'decoded' | 'unknown' | 'invalid';
  address: `0x${string}`;
  transactionHash: Hex;
  logIndex: number;
  protocol?: string;
  eventName?: string;
  args?: readonly unknown[] | Record<string, unknown>;
  reason?: string;
}

function normalizeAddress(address: `0x${string}`): string {
  return address.toLowerCase();
}

export class AbiRegistry {
  private readonly registrations = new Map<string, AbiRegistration>();

  register(registration: AbiRegistration): void {
    this.registrations.set(normalizeAddress(registration.address), registration);
  }

  registerMany(registrations: readonly AbiRegistration[]): void {
    for (const registration of registrations) this.register(registration);
  }

  get(address: `0x${string}`): AbiRegistration | undefined {
    return this.registrations.get(normalizeAddress(address));
  }

  has(address: `0x${string}`): boolean {
    return this.registrations.has(normalizeAddress(address));
  }
}

export class TransactionDecoder {
  constructor(private readonly registry: AbiRegistry) {}

  decode(transaction: TransactionEnvelope): DecodedTransaction {
    if (transaction.to === null) {
      return {
        status: 'unknown',
        hash: transaction.hash,
        to: null,
        reason: 'contract_creation',
      };
    }

    const registration = this.registry.get(transaction.to);
    if (registration === undefined) {
      return {
        status: 'unknown',
        hash: transaction.hash,
        to: transaction.to,
        reason: 'address_not_registered',
      };
    }

    try {
      const decoded = decodeFunctionData({
        abi: registration.abi,
        data: transaction.input,
      });
      const result: DecodedTransaction = {
        status: 'decoded',
        hash: transaction.hash,
        to: transaction.to,
        protocol: registration.protocol,
        functionName: decoded.functionName,
      };
      if (decoded.args !== undefined) result.args = decoded.args;
      return result;
    } catch (error) {
      return {
        status: 'invalid',
        hash: transaction.hash,
        to: transaction.to,
        protocol: registration.protocol,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

export class EventDecoder {
  constructor(private readonly registry: AbiRegistry) {}

  decode(log: LogEnvelope): DecodedEvent {
    const registration = this.registry.get(log.address);
    if (registration === undefined) {
      return {
        status: 'unknown',
        address: log.address,
        transactionHash: log.transactionHash,
        logIndex: log.logIndex,
        reason: 'address_not_registered',
      };
    }

    try {
      const decoded = decodeEventLog({
        abi: registration.abi,
        data: log.data,
        topics: [...log.topics],
      });
      const result: DecodedEvent = {
        status: 'decoded',
        address: log.address,
        transactionHash: log.transactionHash,
        logIndex: log.logIndex,
        protocol: registration.protocol,
      };
      if (decoded.eventName !== undefined) result.eventName = decoded.eventName;
      if (decoded.args !== undefined) result.args = decoded.args;
      return result;
    } catch (error) {
      return {
        status: 'invalid',
        address: log.address,
        transactionHash: log.transactionHash,
        logIndex: log.logIndex,
        protocol: registration.protocol,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
