import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, beginCell, toNano } from '@ton/core';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import { OrderType, UserOrder } from '../wrappers/UserOrder';
import { JettonMinter } from '../wrappers/JettonMinter';
import { JettonWallet } from '../wrappers/JettonWallet';
import {
    assertJettonBalanceEqual,
    createJettonOrderPosition,
    createJettonTonOrderPosition,
    deployJettonWithWallet,
    getOrderByID,
    setupMasterOrder,
} from './helpers';
import { MasterOrder } from '../wrappers/MasterOrder';

describe('UserOrder', () => {
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
    let userOrder: SandboxContract<UserOrder>;

    let jettonsCreator: Array<{
        jettonMinter: SandboxContract<JettonMinter>;
        jettonWallet: SandboxContract<JettonWallet>;
    }>;
    let jettonsExecutor: Array<{
        jettonMinter: SandboxContract<JettonMinter>;
        jettonWallet: SandboxContract<JettonWallet>;
    }>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        deployer = await blockchain.treasury('deployer');
        creator = await blockchain.treasury('creator');
        executor = await blockchain.treasury('executor');

        masterOrder = await setupMasterOrder(blockchain, deployer, masterOrderCode, userOrderCode);
        jettonsCreator = [];
        jettonsExecutor = [];
        for (let i = 0; i < 2; i++) {
            jettonsCreator.push(
                await deployJettonWithWallet(
                    blockchain,
                    deployer,
                    jettonMinterCode,
                    jettonWalletCode,
                    creator.address,
                    toNano(100),
                ),
            );
            jettonsExecutor.push(
                await deployJettonWithWallet(
                    blockchain,
                    deployer,
                    jettonMinterCode,
                    jettonWalletCode,
                    executor.address,
                    toNano(100),
                ),
            );
        }

        await createJettonOrderPosition(
            creator,
            masterOrder,
            1,
            jettonsCreator[0].jettonWallet,
            toNano(10),
            jettonsExecutor[0].jettonMinter,
            toNano(20),
        );

        userOrder = blockchain.openContract(
            UserOrder.createFromAddress(await masterOrder.getWalletAddress(creator.address)),
        );
        expect((await userOrder.getOrders())?.keys().length).toEqual(1);
    });

    it('execute jetton-jetton order successfull', async () => {
        const ordersDict = await userOrder.getOrders();
        const orderId = ordersDict.keys()[0];

        const result = await jettonsExecutor[0].jettonWallet.sendTransfer(executor.getSender(), {
            value: toNano(0.4),
            toAddress: userOrder.address,
            queryId: 123,
            jettonAmount: toNano(20),
            fwdAmount: toNano(0.3),
            fwdPayload: beginCell()
                .storeUint(0xa0cef9d9, 32) // op code - execute_order
                .storeUint(234, 64) // query id
                .storeUint(orderId, 32) // order id
                .endCell(),
        });

        // User -> User Jetton Wallet
        expect(result.transactions).toHaveTransaction({
            from: executor.address,
            to: jettonsExecutor[0].jettonWallet.address,
            deploy: false,
            success: true,
        });

        const jetton2_wallet_user_order = await jettonsExecutor[0].jettonMinter.getWalletAddress(userOrder.address);
        // User Jetton Wallet -> User Order Jetton Wallet
        expect(result.transactions).toHaveTransaction({
            from: jettonsExecutor[0].jettonWallet.address,
            to: jetton2_wallet_user_order,
            deploy: true,
            success: true,
        });

        // User Order Jetton Wallet -> User Order
        expect(result.transactions).toHaveTransaction({
            from: jetton2_wallet_user_order,
            to: userOrder.address,
            deploy: false,
            success: true,
        });

        // Send jettons to creator and executor
        // User Order -> User Order Jetton1 Wallet
        expect(result.transactions).toHaveTransaction({
            from: userOrder.address,
            to: jetton2_wallet_user_order,
            deploy: false,
            success: true,
        });
        const jetton2_creator_wallet = await jettonsExecutor[0].jettonMinter.getWalletAddress(creator.address);
        // User Order Jetton1 Wallet -> Creator Jetton1 Wallet
        expect(result.transactions).toHaveTransaction({
            from: jetton2_wallet_user_order,
            to: jetton2_creator_wallet,
            deploy: true,
            success: true,
        });

        const jetton1_wallet_user_order = await jettonsCreator[0].jettonMinter.getWalletAddress(userOrder.address);
        // User Order -> User Order Jetton2 Wallet
        expect(result.transactions).toHaveTransaction({
            from: userOrder.address,
            to: jetton1_wallet_user_order,
            deploy: false,
            success: true,
        });
        const jetton1_executor_wallet = await jettonsCreator[0].jettonMinter.getWalletAddress(executor.address);
        // User Order Jetton1 Wallet -> Creator Jetton1 Wallet
        expect(result.transactions).toHaveTransaction({
            from: jetton1_wallet_user_order,
            to: jetton1_executor_wallet,
            deploy: true,
            success: true,
        });

        expect((await userOrder.getOrders())?.keys().length).toEqual(0);

        // Valid jetton balances after execution
        await assertJettonBalanceEqual(blockchain, jetton2_creator_wallet, toNano(20));
        await assertJettonBalanceEqual(blockchain, jetton1_executor_wallet, toNano(10));
    });

    it('create and execute multiple orders successfull', async () => {
        const order1Id = (await userOrder.getOrders()).keys()[0];
        await createJettonOrderPosition(
            creator,
            masterOrder,
            2,
            jettonsCreator[1].jettonWallet,
            toNano(10),
            jettonsExecutor[1].jettonMinter,
            toNano(20),
        );
        expect((await userOrder.getOrders())?.keys().length).toEqual(2);

        await jettonsExecutor[0].jettonWallet.sendTransfer(executor.getSender(), {
            value: toNano(0.4),
            toAddress: userOrder.address,
            queryId: 123,
            jettonAmount: toNano(20),
            fwdAmount: toNano(0.3),
            fwdPayload: beginCell()
                .storeUint(0xa0cef9d9, 32) // op code - execute_order
                .storeUint(234, 64) // query id
                .storeUint(order1Id, 32) // order id
                .endCell(),
        });
        expect((await userOrder.getOrders())?.keys().length).toEqual(1);

        // Execute second order
        const order2Id = (await userOrder.getOrders()).keys()[0];
        await jettonsExecutor[1].jettonWallet.sendTransfer(executor.getSender(), {
            value: toNano(0.4),
            toAddress: userOrder.address,
            queryId: 123,
            jettonAmount: toNano(20),
            fwdAmount: toNano(0.3),
            fwdPayload: beginCell()
                .storeUint(0xa0cef9d9, 32) // op code - execute_order
                .storeUint(234, 64) // query id
                .storeUint(order2Id, 32) // order id
                .endCell(),
        });
        expect((await userOrder.getOrders())?.keys().length).toEqual(0);
    });

    it('execute ton-jetton order successfull', async () => {
        const test_order_id = 2;

        const user_order_address = await masterOrder.getWalletAddress(creator.address);
        const user_order_jetton2_address = await jettonsExecutor[1].jettonMinter.getWalletAddress(user_order_address);
        // Create an order
        await masterOrder.sendCreateTonJettonOrder(creator.getSender(), {
            value: toNano(0.2),
            queryId: 123,
            orderId: test_order_id,
            fromAmount: toNano(10),
            toAddress: user_order_jetton2_address,
            toAmount: toNano(20),
            toMasterAddress: jettonsExecutor[1].jettonMinter.address,
        });

        expect(await getOrderByID(userOrder, test_order_id)).toBeTruthy();

        const executor_balance = await executor.getBalance();
        // Execute
        const result = await jettonsExecutor[1].jettonWallet.sendTransfer(executor.getSender(), {
            value: toNano('0.2'),
            toAddress: userOrder.address,
            queryId: 123,
            jettonAmount: toNano(20),
            fwdAmount: toNano(0.1),
            fwdPayload: beginCell()
                .storeUint(0xa0cef9d9, 32) // op code - execute_order
                .storeUint(234, 64) // query id
                .storeUint(2, 32) // order id
                .endCell(),
        });

        // User -> User Jetton Wallet
        expect(result.transactions).toHaveTransaction({
            from: executor.address,
            to: jettonsExecutor[1].jettonWallet.address,
            deploy: false,
            success: true,
        });

        const jetton2_wallet_user_order = await jettonsExecutor[1].jettonMinter.getWalletAddress(userOrder.address);
        // User Jetton Wallet -> User Order Jetton Wallet
        expect(result.transactions).toHaveTransaction({
            from: jettonsExecutor[1].jettonWallet.address,
            to: jetton2_wallet_user_order,
            deploy: true,
            success: true,
        });

        // User Order Jetton Wallet -> User Order
        expect(result.transactions).toHaveTransaction({
            from: jetton2_wallet_user_order,
            to: userOrder.address,
            deploy: false,
            success: true,
        });

        // Send jettons to creator and ton executor
        // User Order -> User Order Jetton1 Wallet
        expect(result.transactions).toHaveTransaction({
            from: userOrder.address,
            to: jetton2_wallet_user_order,
            deploy: false,
            success: true,
        });
        const jetton2_creator_wallet = await jettonsExecutor[1].jettonMinter.getWalletAddress(creator.address);
        // User Order Jetton1 Wallet -> Creator Jetton1 Wallet
        expect(result.transactions).toHaveTransaction({
            from: jetton2_wallet_user_order,
            to: jetton2_creator_wallet,
            deploy: true,
            success: true,
        });

        // User Order -> User Order Jetton2 Wallet
        expect(result.transactions).toHaveTransaction({
            from: userOrder.address,
            to: executor.address,
            deploy: false,
            success: true,
        });

        // 1 jetton-jetton order left
        expect((await userOrder.getOrders())?.keys().length).toEqual(1);
        expect(await getOrderByID(userOrder, test_order_id)).not.toBeTruthy();

        // Valid jetton balances after execution
        await assertJettonBalanceEqual(blockchain, jetton2_creator_wallet, toNano(20));
        // 0.2 - commission
        expect((await executor.getBalance()) - executor_balance).toBeGreaterThan(toNano(9.8));
    });

    it('execute jetton-ton order successfull', async () => {
        const test_order_id = 2;

        // Create order
        await createJettonTonOrderPosition(
            creator,
            masterOrder,
            jettonsCreator[0].jettonWallet,
            test_order_id,
            toNano(10),
            toNano(20),
        );
        expect(await getOrderByID(userOrder, test_order_id)).toBeTruthy();

        const creatorBalance = await creator.getBalance();

        // Execute an order
        const result = await userOrder.sendExecuteJettonTonOrder(executor.getSender(), {
            value: toNano(20.2),
            queryId: 125,
            orderId: test_order_id,
            amount: toNano(20),
        });

        // User -> User Order
        expect(result.transactions).toHaveTransaction({
            from: executor.address,
            to: userOrder.address,
            deploy: false,
            success: true,
        });

        // Send ton to creator and jettons executor
        // User Order -> User Order Jetton1 Wallet
        expect(result.transactions).toHaveTransaction({
            from: userOrder.address,
            to: creator.address,
            deploy: false,
            success: true,
        });

        const jetton1_wallet_user_order = await jettonsCreator[0].jettonMinter.getWalletAddress(userOrder.address);
        // User Order -> User Order Jetton2 Wallet
        expect(result.transactions).toHaveTransaction({
            from: userOrder.address,
            to: jetton1_wallet_user_order,
            deploy: false,
            success: true,
        });
        const jetton1_executor_wallet = await jettonsCreator[0].jettonMinter.getWalletAddress(executor.address);
        // User Order Jetton1 Wallet -> Creator Jetton1 Wallet
        expect(result.transactions).toHaveTransaction({
            from: jetton1_wallet_user_order,
            to: jetton1_executor_wallet,
            deploy: true,
            success: true,
        });

        // 1 order is from setup for jetton-jetton
        expect((await userOrder.getOrders())?.keys().length).toEqual(1);
        expect(await getOrderByID(userOrder, test_order_id)).not.toBeTruthy();

        // Valid balances after execution
        // ~0.1 ton commission
        expect((await creator.getBalance()) - creatorBalance).toBeGreaterThan(toNano(20) - toNano(0.1));
        await assertJettonBalanceEqual(blockchain, jetton1_executor_wallet, toNano(10));
    });

    it('execute partial jetton-jetton order successfull', async () => {
        const ordersDict = await userOrder.getOrders();
        const orderId = ordersDict.keys()[0];

        await jettonsExecutor[0].jettonWallet.sendTransfer(executor.getSender(), {
            value: toNano(0.4),
            toAddress: userOrder.address,
            queryId: 123,
            jettonAmount: toNano(5), // 0.25 part of whole order
            fwdAmount: toNano(0.3),
            fwdPayload: beginCell()
                .storeUint(0xa0cef9d9, 32) // op code - execute_order
                .storeUint(234, 64) // query id
                .storeUint(orderId, 32) // order id
                .endCell(),
        });

        const all_orders = await userOrder.getOrders();
        expect(all_orders?.keys().length).toEqual(1);

        // Valid order balance
        const order = all_orders.get(orderId);
        expect(order?.fromAmount).toEqual(toNano(10));
        expect(order?.fromAmountLeft).toEqual(toNano(7.5));
        expect(order?.toAmount).toEqual(toNano(20));

        // Valid order balance in wallets
        const jetton1_wallet_user_order = await jettonsCreator[0].jettonMinter.getWalletAddress(userOrder.address);
        await assertJettonBalanceEqual(blockchain, jetton1_wallet_user_order, toNano(7.5));

        // Valid user balances after execution
        const jetton2_creator_wallet = await jettonsExecutor[0].jettonMinter.getWalletAddress(creator.address);
        await assertJettonBalanceEqual(blockchain, jetton2_creator_wallet, toNano(5));
        const jetton1_executor_wallet = await jettonsCreator[0].jettonMinter.getWalletAddress(executor.address);
        await assertJettonBalanceEqual(blockchain, jetton1_executor_wallet, toNano(2.5));
    });

    it('execute partial jetton-jetton order multiple times', async () => {
        const ordersDict = await userOrder.getOrders();
        const orderId = ordersDict.keys()[0];

        for (var i = 0; i < 5; i++)
            await jettonsExecutor[0].jettonWallet.sendTransfer(executor.getSender(), {
                value: toNano(0.3),
                toAddress: userOrder.address,
                queryId: 123,
                jettonAmount: toNano(2), // 2/20 part of whole order
                fwdAmount: toNano(0.2),
                fwdPayload: beginCell()
                    .storeUint(0xa0cef9d9, 32) // op code - execute_order
                    .storeUint(234, 64) // query id
                    .storeUint(orderId, 32) // order id
                    .endCell(),
            });

        const all_orders = await userOrder.getOrders();
        expect(all_orders?.keys().length).toEqual(1);

        // Valid order balance
        const order = all_orders.get(orderId);
        expect(order?.fromAmount).toEqual(toNano(10));
        expect(order?.fromAmountLeft).toEqual(toNano(10 - 5 * 10 * (2 / 20)));
        expect(order?.toAmount).toEqual(toNano(20));

        // Valid order balance in wallets
        const jetton1_wallet_user_order = await jettonsCreator[0].jettonMinter.getWalletAddress(userOrder.address);
        await assertJettonBalanceEqual(blockchain, jetton1_wallet_user_order, toNano(10 - 5 * 10 * (2 / 20)));

        // Valid user balances after execution
        const jetton2_creator_wallet = await jettonsExecutor[0].jettonMinter.getWalletAddress(creator.address);
        await assertJettonBalanceEqual(blockchain, jetton2_creator_wallet, toNano(5 * 20 * (2 / 20)));
        const jetton1_executor_wallet = await jettonsCreator[0].jettonMinter.getWalletAddress(executor.address);
        await assertJettonBalanceEqual(blockchain, jetton1_executor_wallet, toNano(5 * 10 * (2 / 20)));
    });

    it('execute partial ton-jetton order successfull', async () => {
        const test_order_id = 2;

        const user_order_address = await masterOrder.getWalletAddress(creator.address);
        const user_order_jetton2_address = await jettonsExecutor[1].jettonMinter.getWalletAddress(user_order_address);
        // Create an order
        await masterOrder.sendCreateTonJettonOrder(creator.getSender(), {
            value: toNano(0.2),
            queryId: 123,
            orderId: test_order_id,
            fromAmount: toNano(10),
            toAddress: user_order_jetton2_address,
            toAmount: toNano(20),
            toMasterAddress: jettonsExecutor[1].jettonMinter.address,
        });

        expect(await getOrderByID(userOrder, test_order_id)).toBeTruthy();

        const before_execution = await executor.getBalance();

        // Execute
        await jettonsExecutor[1].jettonWallet.sendTransfer(executor.getSender(), {
            value: toNano('0.2'),
            toAddress: userOrder.address,
            queryId: 123,
            jettonAmount: toNano(8), // 8/20 part of whole order
            fwdAmount: toNano(0.1),
            fwdPayload: beginCell()
                .storeUint(0xa0cef9d9, 32) // op code - execute_order
                .storeUint(234, 64) // query id
                .storeUint(2, 32) // order id
                .endCell(),
        });

        const order = await getOrderByID(userOrder, test_order_id);
        expect(order).toBeTruthy();

        // Valid order balance
        expect(order?.fromAmount).toEqual(toNano(10));
        expect(order?.fromAmountLeft).toEqual(toNano(10 - (10 * 8) / 20));
        expect(order?.toAmount).toEqual(toNano(20));

        // Valid order balance in wallets
        let balance = (await blockchain.getContract(user_order_address)).balance;
        expect(balance).toBeGreaterThan(toNano(10 - (10 * 8) / 20));

        // Valid user balances after execution
        const jetton2_creator_wallet = await jettonsExecutor[1].jettonMinter.getWalletAddress(creator.address);
        await assertJettonBalanceEqual(blockchain, jetton2_creator_wallet, toNano(8));
        const executor_balance = await executor.getBalance();
        expect(executor_balance - before_execution).toBeGreaterThan(toNano((10 * 8) / 20 - 0.2));
    });

    it('execute partial jetton-ton order successfull', async () => {
        const test_order_id = 2;

        // Create order
        await createJettonTonOrderPosition(
            creator,
            masterOrder,
            jettonsCreator[1].jettonWallet,
            test_order_id,
            toNano(10),
            toNano(20),
        );
        expect(await getOrderByID(userOrder, test_order_id)).toBeTruthy();

        const before_execution = await creator.getBalance();

        // Execute an order
        await userOrder.sendExecuteJettonTonOrder(executor.getSender(), {
            value: toNano(1.2),
            queryId: 125,
            orderId: test_order_id,
            amount: toNano(1),
        });

        const order = await getOrderByID(userOrder, test_order_id);
        expect(order).toBeTruthy();

        // Valid order balance
        expect(order?.fromAmount).toEqual(toNano(10));
        expect(order?.fromAmountLeft).toEqual(toNano(10 - (10 * 1) / 20));
        expect(order?.toAmount).toEqual(toNano(20));

        // Valid order balance in wallets
        const jetton1_wallet_user_order = await jettonsCreator[1].jettonMinter.getWalletAddress(userOrder.address);
        await assertJettonBalanceEqual(blockchain, jetton1_wallet_user_order, toNano(10 - (10 * 1) / 20));

        // Valid order balance in wallets
        expect((await creator.getBalance()) - before_execution).toBeGreaterThan(toNano((10 * 1) / 20 - 0.2)); // ~0.2 ton commission
        const jetton1_executor_wallet = await jettonsCreator[1].jettonMinter.getWalletAddress(executor.address);
        await assertJettonBalanceEqual(blockchain, jetton1_executor_wallet, toNano(10 / 20));
    });

    it('close jetton-jetton order successfull', async () => {
        const test_order_id = 1; // created in test setup

        const result = await userOrder.sendCloseOrder(creator.getSender(), {
            value: toNano(0.2),
            queryId: 123,
            orderId: test_order_id,
        });

        // User -> User Order
        expect(result.transactions).toHaveTransaction({
            from: creator.address,
            to: userOrder.address,
            deploy: false,
            success: true,
        });

        const jetton1_wallet_user_order = await jettonsCreator[0].jettonMinter.getWalletAddress(userOrder.address);
        // Send jettons back to creator
        // User Order -> User Order Jetton1 Wallet
        expect(result.transactions).toHaveTransaction({
            from: userOrder.address,
            to: jetton1_wallet_user_order,
            deploy: false,
            success: true,
        });
        const jetton1_creator_wallet = await jettonsCreator[0].jettonMinter.getWalletAddress(creator.address);
        // User Order Jetton1 Wallet -> Creator Jetton1 Wallet
        expect(result.transactions).toHaveTransaction({
            from: jetton1_wallet_user_order,
            to: jetton1_creator_wallet,
            deploy: false,
            success: true,
        });

        expect((await userOrder.getOrders())?.keys().length).toEqual(0);

        // Valid jetton balances after execution
        await assertJettonBalanceEqual(blockchain, jetton1_creator_wallet, toNano(100));
    });

    it('close ton-jetton order successfull', async () => {
        const test_order_id = 2;

        const user_order_address = await masterOrder.getWalletAddress(creator.address);
        const user_order_jetton2_address = await jettonsExecutor[1].jettonMinter.getWalletAddress(user_order_address);
        // Create an order
        await masterOrder.sendCreateTonJettonOrder(creator.getSender(), {
            value: toNano(0.2),
            queryId: 123,
            orderId: 2,
            fromAmount: toNano(10),
            toAddress: user_order_jetton2_address,
            toAmount: toNano(20),
            toMasterAddress: jettonsExecutor[1].jettonMinter.address,
        });
        expect(await getOrderByID(userOrder, test_order_id)).toBeTruthy();

        const creator_balance = await creator.getBalance();

        const result = await userOrder.sendCloseOrder(creator.getSender(), {
            value: toNano(0.2),
            queryId: 123,
            orderId: test_order_id,
        });

        // User -> User Order
        expect(result.transactions).toHaveTransaction({
            from: creator.address,
            to: userOrder.address,
            deploy: false,
            success: true,
        });

        // Send ton back to creator
        // User Order -> User
        expect(result.transactions).toHaveTransaction({
            from: userOrder.address,
            to: creator.address,
            deploy: false,
            success: true,
        });

        expect((await userOrder.getOrders())?.keys().length).toEqual(1);
        expect((await creator.getBalance()) - creator_balance).toBeGreaterThan(toNano(9.7));
    });
});
