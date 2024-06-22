import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Address, Cell, beginCell, toNano } from '@ton/core';
import '@ton/test-utils';
import { JettonMinter } from '../wrappers/JettonMinter';
import { JettonWallet } from '../wrappers/JettonWallet';
import { MasterOrder } from '../wrappers/MasterOrder';
import { OrderType, UserOrder } from '../wrappers/UserOrder';

export async function deployJettonWithWallet(
    blockchain: Blockchain,
    deployer: SandboxContract<TreasuryContract>,
    jettonMinterCode: Cell,
    jettonWalletCode: Cell,
    sendTokensToAddr: Address,
    jettonsAmount: bigint,
) {
    const randomSeed = Math.floor(Math.random() * 10000);
    const jettonMinter = blockchain.openContract(
        JettonMinter.createFromConfig(
            {
                adminAddress: deployer.address,
                content: beginCell().storeUint(randomSeed, 256).endCell(),
                jettonWalletCode: jettonWalletCode,
            },
            jettonMinterCode,
        ),
    );
    let result = await jettonMinter.sendDeploy(deployer.getSender(), toNano('0.05'));

    expect(result.transactions).toHaveTransaction({
        from: deployer.address,
        to: jettonMinter.address,
        deploy: true,
        success: true,
    });

    result = await jettonMinter.sendMint(deployer.getSender(), {
        toAddress: sendTokensToAddr,
        jettonAmount: jettonsAmount,
        amount: toNano('0.05'),
        queryId: Date.now(),
        value: toNano('0.2'),
    });
    expect(result.transactions).toHaveTransaction({
        from: deployer.address,
        to: jettonMinter.address,
        deploy: false,
        success: true,
    });

    const creator_wallet_addr = await jettonMinter.getWalletAddress(sendTokensToAddr);
    const walletJetton = blockchain.openContract(JettonWallet.createFromAddress(creator_wallet_addr));
    return {
        jettonMinter: jettonMinter,
        jettonWallet: walletJetton,
    };
}

export async function setupMasterOrder(
    blockchain: Blockchain,
    deployer: SandboxContract<TreasuryContract>,
    masterOrderCode: Cell,
    userOrderCode: Cell,
) {
    const masterOrder = blockchain.openContract(
        MasterOrder.createFromConfig(
            {
                admin: deployer.address,
                userOrderCode: userOrderCode,
            },
            masterOrderCode,
        ),
    );
    let result = await masterOrder.sendDeploy(deployer.getSender(), toNano('0.5'));
    expect(result.transactions).toHaveTransaction({
        from: deployer.address,
        to: masterOrder.address,
        deploy: true,
        success: true,
    });

    return masterOrder;
}

export async function createJettonOrderPosition(
    creator: SandboxContract<TreasuryContract>,
    masterOrder: SandboxContract<MasterOrder>,
    orderId: number,
    fromJettonWallet: SandboxContract<JettonWallet>,
    fromAmount: bigint,
    toJettonMinter: SandboxContract<JettonMinter>,
    toAmount: bigint,
) {
    const user_order_address = await masterOrder.getWalletAddress(creator.address);
    const user_order_jetton_address = await toJettonMinter.getWalletAddress(user_order_address);

    const result = await fromJettonWallet.sendTransfer(creator.getSender(), {
        value: toNano('0.3'),
        toAddress: masterOrder.address,
        queryId: 1,
        jettonAmount: fromAmount,
        fwdAmount: toNano('0.2'),
        fwdPayload: beginCell()
            .storeUint(0xc1c6ebf9, 32) // op code - create_order
            .storeUint(111, 64) // query id
            .storeUint(OrderType.JETTON_JETTON, 8)
            .storeUint(orderId, 32)
            .storeAddress(user_order_jetton_address)
            .storeCoins(toAmount)
            .storeAddress(toJettonMinter.address)
            .endCell(),
    });

    return result;
}

export async function createJettonTonOrderPosition(
    creator: SandboxContract<TreasuryContract>,
    masterOrder: SandboxContract<MasterOrder>,
    fromJettonWallet: SandboxContract<JettonWallet>,
    orderId: number,
    fromAmount: bigint,
    toAmount: bigint,
) {
    const result = await fromJettonWallet.sendTransfer(creator.getSender(), {
        value: toNano('0.3'),
        toAddress: masterOrder.address,
        queryId: 123,
        jettonAmount: fromAmount,
        fwdAmount: toNano('0.2'),
        fwdPayload: beginCell()
            .storeUint(0xc1c6ebf9, 32) // op code - create_order
            .storeUint(123, 64) // query id
            .storeUint(OrderType.JETTON_TON, 8)
            .storeUint(orderId, 32)
            .storeCoins(toAmount)
            .endCell(),
    });

    return result;
}

export async function assertJettonBalanceEqual(blockchain: Blockchain, jettonAddress: Address, equalTo: bigint) {
    const jettonWallet = blockchain.openContract(JettonWallet.createFromAddress(jettonAddress));
    expect(await jettonWallet.getJettonBalance()).toEqual(equalTo);
}

export async function getOrderID(userOrder: SandboxContract<UserOrder>, orderType: OrderType): Promise<bigint | null> {
    const ordersDict = await userOrder.getOrders();
    for (var orderId of ordersDict.keys()) {
        if (ordersDict.get(orderId)!.orderType === orderType) {
            return orderId;
        }
    }
    return null;
}
