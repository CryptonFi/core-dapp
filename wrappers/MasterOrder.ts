import {
    Address,
    beginCell,
    Cell,
    Contract,
    contractAddress,
    ContractProvider,
    Sender,
    SendMode,
    TupleItemSlice,
} from '@ton/core';

export type MasterOrderConfig = {
    admin: Address;
    userOrderCode: Cell;
};

export function masterOrderConfigToCell(config: MasterOrderConfig): Cell {
    return beginCell().storeAddress(config.admin).storeRef(config.userOrderCode).endCell();
}

export class MasterOrder implements Contract {
    constructor(
        readonly address: Address,
        readonly init?: { code: Cell; data: Cell },
    ) {}

    static createFromAddress(address: Address) {
        return new MasterOrder(address);
    }

    static createFromConfig(config: MasterOrderConfig, code: Cell, workchain = 0) {
        const data = masterOrderConfigToCell(config);
        const init = { code, data };
        return new MasterOrder(contractAddress(workchain, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
        });
    }

    async sendCreateTonJettonOrder(
        provider: ContractProvider,
        via: Sender,
        opts: {
            value: bigint;
            queryId: number;
            orderId: number;
            fromAmount: bigint;
            toAddress: Address;
            toAmount: number;
            toMasterAddress: Address;
        },
    ) {
        const result = await provider.internal(via, {
            value: opts.value + opts.fromAmount,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(0x76fd6f67, 32) // create_ton_order
                .storeUint(opts.queryId, 64)
                .storeUint(opts.orderId, 32)
                .storeCoins(opts.fromAmount)
                .storeAddress(opts.toAddress)
                .storeCoins(opts.toAmount)
                .storeAddress(opts.toMasterAddress)
                .endCell(),
        });

        return result;
    }

    async getWalletAddress(provider: ContractProvider, address: Address) {
        const result = await provider.get('get_wallet_address', [
            {
                type: 'slice',
                cell: beginCell().storeAddress(address).endCell(),
            } as TupleItemSlice,
        ]);

        return result.stack.readAddress();
    }

    async getStatus(provider: ContractProvider): Promise<bigint> {
        const result = await provider.get('get_status', []);
        return result.stack.readBigNumber();
    }
}
