import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, beginCell, toNano } from '@ton/core';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import { randomAddress } from '@ton/test-utils';
import { JettonMinter } from '../wrappers/JettonMinter';
import { JettonWallet } from '../wrappers/JettonWallet';
import { MasterOrder } from '../wrappers/MasterOrder';
import { OrderType, UserOrder } from '../wrappers/UserOrder';
import {
    assertJettonBalanceEqual,
    createJettonOrderPosition,
    deployJettonWithWallet,
    setupMasterOrder,
} from './helpers';

describe('MasterOrder', () => {
    let masterOrderCode: Cell;
    let userOrderCode: Cell;
    let jettonMinterCode: Cell;
    let jettonWalletCode: Cell;

    beforeAll(async () => {
        masterOrderCode = await compile('MasterOrder');
        userOrderCode = await compile('UserOrder');
        jettonMinterCode = await compile('JettonMinter');
        jettonWalletCode = await compile('JettonWallet');
    });

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let creator: SandboxContract<TreasuryContract>;
    let executor: SandboxContract<TreasuryContract>;
    let masterOrder: SandboxContract<MasterOrder>;
    let jetton1: {
        jettonMinter: SandboxContract<JettonMinter>;
        jettonWallet: SandboxContract<JettonWallet>;
    };
    let jetton2: {
        jettonMinter: SandboxContract<JettonMinter>;
        jettonWallet: SandboxContract<JettonWallet>;
    };

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        deployer = await blockchain.treasury('deployer');
        creator = await blockchain.treasury('creator');
        executor = await blockchain.treasury('executor');

        masterOrder = await setupMasterOrder(blockchain, deployer, masterOrderCode, userOrderCode);

        jetton1 = await deployJettonWithWallet(
            blockchain,
            deployer,
            jettonMinterCode,
            jettonWalletCode,
            creator.address,
            toNano(100),
        );
        jetton2 = await deployJettonWithWallet(
            blockchain,
            deployer,
            jettonMinterCode,
            jettonWalletCode,
            executor.address,
            toNano(200),
        );
    });

    it('should deploy', async () => {
        // the check is done inside beforeEach
    });

    it('mint UserOrder contract with jetton-jetton position', async () => {
        const result = await createJettonOrderPosition(
            creator,
            masterOrder,
            1,
            jetton1.jettonWallet,
            toNano(10),
            jetton2.jettonMinter,
            toNano(20),
        );

        // User -> User Jetton1 Wallet
        expect(result.transactions).toHaveTransaction({
            from: creator.address,
            to: jetton1.jettonWallet.address,
            deploy: false,
            success: true,
        });

        const jetton_wallet_master_order = await jetton1.jettonMinter.getWalletAddress(masterOrder.address);
        // User Jetton1 Wallet -> Master Order Jetton1 Wallet
        expect(result.transactions).toHaveTransaction({
            from: jetton1.jettonWallet.address,
            to: jetton_wallet_master_order,
            deploy: true,
            success: true,
        });

        // Master Order Jetton1 Wallet -> Master Order
        expect(result.transactions).toHaveTransaction({
            from: jetton_wallet_master_order,
            to: masterOrder.address,
            deploy: false,
            success: true,
        });

        const user_order_address = await masterOrder.getWalletAddress(creator.address);
        // Master Order -> User Order
        expect(result.transactions).toHaveTransaction({
            from: masterOrder.address,
            to: user_order_address,
            deploy: true,
            success: true,
        });

        // Master Order -> Master Order Jetton1 Wallet
        expect(result.transactions).toHaveTransaction({
            from: masterOrder.address,
            to: jetton_wallet_master_order,
            deploy: false,
            success: true,
        });

        const jetton_wallet_user_order = await jetton1.jettonMinter.getWalletAddress(user_order_address);
        // Master Order Jetton1 Wallet -> User Order Jetton1 Wallet
        expect(result.transactions).toHaveTransaction({
            from: jetton_wallet_master_order,
            to: jetton_wallet_user_order,
            deploy: true,
            success: true,
        });

        // Jettons are in User Order Wallet
        await assertJettonBalanceEqual(blockchain, jetton_wallet_user_order, toNano(10));
    });

    it('create a new jetton-jetton order', async () => {
        const user_order_address = await masterOrder.getWalletAddress(creator.address);
        const user_order_jetton2_address = await jetton2.jettonMinter.getWalletAddress(user_order_address);
        const user_order_jetton1_address = await jetton1.jettonMinter.getWalletAddress(user_order_address);
        await createJettonOrderPosition(
            creator,
            masterOrder,
            1,
            jetton1.jettonWallet,
            toNano(10),
            jetton2.jettonMinter,
            toNano(20),
        );

        const user_order = blockchain.openContract(UserOrder.createFromAddress(user_order_address));
        const orders = await user_order.getOrders();

        expect(orders?.keys().length).toEqual(1);
        expect(orders?.values()[0].orderType).toEqual(OrderType.JETTON_JETTON);
        expect(orders?.values()[0].fromAddress!.toString()).toEqual(user_order_jetton1_address.toString());
        expect(orders?.values()[0].fromAmount).toEqual(toNano(10));
        expect(orders?.values()[0].fromAmountLeft).toEqual(toNano(10));
        expect(orders?.values()[0].toAddress!.toString()).toEqual(user_order_jetton2_address.toString());
        expect(orders?.values()[0].toAmount).toEqual(toNano(20));
        expect(orders?.values()[0].toMasterAddress!.toString()).toEqual(jetton2.jettonMinter.address.toString());
    });

    it('mint UserOrder contract with ton-jetton position', async () => {
        const user_order_address = await masterOrder.getWalletAddress(creator.address);
        const user_order_jetton2_address = await jetton2.jettonMinter.getWalletAddress(user_order_address);

        const result = await masterOrder.sendCreateTonJettonOrder(creator.getSender(), {
            value: toNano(0.2),
            queryId: 123,
            orderId: 1,
            fromAmount: toNano(10),
            toAddress: user_order_jetton2_address,
            toAmount: toNano(20),
            toMasterAddress: jetton2.jettonMinter.address,
        });

        // User -> Master order
        expect(result.transactions).toHaveTransaction({
            from: creator.address,
            to: masterOrder.address,
            deploy: false,
            success: true,
        });

        // Master order -> User Order
        expect(result.transactions).toHaveTransaction({
            from: masterOrder.address,
            to: user_order_address,
            deploy: true,
            success: true,
        });

        let balance = (await blockchain.getContract(user_order_address)).balance;
        expect(balance).toBeGreaterThan(toNano(10.1));
    });

    it('create a new ton-jetton order', async () => {
        const user_order_address = await masterOrder.getWalletAddress(creator.address);
        const user_order_jetton2_address = await jetton2.jettonMinter.getWalletAddress(user_order_address);
        await masterOrder.sendCreateTonJettonOrder(creator.getSender(), {
            value: toNano(0.2),
            queryId: 123,
            orderId: 1,
            fromAmount: toNano(10),
            toAddress: user_order_jetton2_address,
            toAmount: toNano(20),
            toMasterAddress: jetton2.jettonMinter.address,
        });

        const user_order = blockchain.openContract(UserOrder.createFromAddress(user_order_address));
        const orders = await user_order.getOrders();

        expect(orders?.keys().length).toEqual(1);
        expect(orders?.values()[0].orderType).toEqual(OrderType.TON_JETTON);
        expect(orders?.values()[0].fromAddress).toBeNull();
        expect(orders?.values()[0].fromAmount).toEqual(toNano(10));
        expect(orders?.values()[0].fromAmountLeft).toEqual(toNano(10));
        expect(orders?.values()[0].toAddress!.toString()).toEqual(user_order_jetton2_address.toString());
        expect(orders?.values()[0].toAmount).toEqual(toNano(20));
        expect(orders?.values()[0].toMasterAddress!.toString()).toEqual(jetton2.jettonMinter.address.toString());
    });

    it('mint UserOrder contract with jetton-ton position', async () => {
        const result = await jetton1.jettonWallet.sendTransfer(creator.getSender(), {
            value: toNano(0.3),
            toAddress: masterOrder.address,
            queryId: 123,
            jettonAmount: toNano(10),
            fwdAmount: toNano(0.2),
            fwdPayload: beginCell()
                .storeUint(0xc1c6ebf9, 32) // op code - create_order
                .storeUint(123, 64) // query id
                .storeUint(OrderType.JETTON_TON, 8)
                .storeUint(1, 32)
                .storeCoins(toNano(20))
                .endCell(),
        });

        // User -> User Jetton1 Wallet
        expect(result.transactions).toHaveTransaction({
            from: creator.address,
            to: jetton1.jettonWallet.address,
            deploy: false,
            success: true,
        });

        const jetton_wallet_master_order = await jetton1.jettonMinter.getWalletAddress(masterOrder.address);
        // User Jetton1 Wallet -> Master Order Jetton1 Wallet
        expect(result.transactions).toHaveTransaction({
            from: jetton1.jettonWallet.address,
            to: jetton_wallet_master_order,
            deploy: true,
            success: true,
        });

        // Master Order Jetton1 Wallet -> Master Order
        expect(result.transactions).toHaveTransaction({
            from: jetton_wallet_master_order,
            to: masterOrder.address,
            deploy: false,
            success: true,
        });

        const user_order_address = await masterOrder.getWalletAddress(creator.address);
        // Master Order -> User Order
        expect(result.transactions).toHaveTransaction({
            from: masterOrder.address,
            to: user_order_address,
            deploy: true,
            success: true,
        });

        // Master Order -> Master Order Jetton1 Wallet
        expect(result.transactions).toHaveTransaction({
            from: masterOrder.address,
            to: jetton_wallet_master_order,
            deploy: false,
            success: true,
        });

        const jetton_wallet_user_order = await jetton1.jettonMinter.getWalletAddress(user_order_address);
        // Master Order Jetton1 Wallet -> User Order Jetton1 Wallet
        expect(result.transactions).toHaveTransaction({
            from: jetton_wallet_master_order,
            to: jetton_wallet_user_order,
            deploy: true,
            success: true,
        });

        // Jettons are in User Order Wallet
        await assertJettonBalanceEqual(blockchain, jetton_wallet_user_order, toNano(10));
    });

    it('create a new jetton-ton order', async () => {
        const user_order_address = await masterOrder.getWalletAddress(creator.address);
        const user_order_jetton1_address = await jetton1.jettonMinter.getWalletAddress(user_order_address);
        await jetton1.jettonWallet.sendTransfer(creator.getSender(), {
            value: toNano(0.3),
            toAddress: masterOrder.address,
            queryId: 123,
            jettonAmount: toNano(10),
            fwdAmount: toNano(0.2),
            fwdPayload: beginCell()
                .storeUint(0xc1c6ebf9, 32) // op code - create_order
                .storeUint(123, 64) // query id
                .storeUint(OrderType.JETTON_TON, 8)
                .storeUint(1, 32)
                .storeCoins(toNano(20))
                .endCell(),
        });

        const user_order = blockchain.openContract(UserOrder.createFromAddress(user_order_address));
        const orders = await user_order.getOrders();

        expect(orders?.keys().length).toEqual(1);
        expect(orders?.values()[0].orderType).toEqual(OrderType.JETTON_TON);
        expect(orders?.values()[0].fromAddress!.toString()).toEqual(user_order_jetton1_address.toString());
        expect(orders?.values()[0].fromAmount).toEqual(toNano(10));
        expect(orders?.values()[0].fromAmountLeft).toEqual(toNano(10));
        expect(orders?.values()[0].toAddress).toBeNull();
        expect(orders?.values()[0].toAmount).toEqual(toNano(20));
    });
});
