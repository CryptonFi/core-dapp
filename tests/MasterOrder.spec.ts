import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, beginCell, toNano } from '@ton/core';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import { randomAddress } from '@ton/test-utils';
import { JettonMinter } from '../wrappers/JettonMinter';
import { JettonWallet } from '../wrappers/JettonWallet';
import { MasterOrder } from '../wrappers/MasterOrder';
import { UserOrder } from '../wrappers/UserOrder';
import { assertJettonBalanceEqual, createOrderPosition, deployJettonWithWallet, setupMasterOrder } from './helpers';

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
            100n,
        );
        jetton2 = await deployJettonWithWallet(
            blockchain,
            deployer,
            jettonMinterCode,
            jettonWalletCode,
            executor.address,
            200n,
        );
    });

    it('should deploy', async () => {
        // the check is done inside beforeEach
    });

    it('mint UserOrder contract', async () => {
        const result = await createOrderPosition(
            creator,
            masterOrder,
            jetton1.jettonWallet,
            10n,
            jetton2.jettonMinter,
            20n,
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

        let balance = (await blockchain.getContract(masterOrder.address)).balance;

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
        await assertJettonBalanceEqual(blockchain, jetton_wallet_user_order, 10n);
    });

    it('create a new order', async () => {
        const user_order_address = await masterOrder.getWalletAddress(creator.address);
        const user_order_jetton2_address = await jetton2.jettonMinter.getWalletAddress(user_order_address);
        const user_order_jetton1_address = await jetton1.jettonMinter.getWalletAddress(user_order_address);

        await jetton1.jettonWallet.sendTransfer(creator.getSender(), {
            value: toNano('0.4'),
            toAddress: masterOrder.address,
            queryId: 2,
            jettonAmount: 10n,
            fwdAmount: toNano('0.3'),
            fwdPayload: beginCell()
                .storeUint(0xc1c6ebf9, 32) // op code - create_order
                .storeUint(222, 64) // query id
                .storeAddress(user_order_jetton2_address)
                .storeUint(20n, 64)
                .endCell(),
        });

        const user_order = blockchain.openContract(UserOrder.createFromAddress(user_order_address));
        const orders = await user_order.getOrders();

        expect(orders?.keys().length).toEqual(1);
        expect(orders?.values()[0].fromAddress.toString()).toEqual(user_order_jetton1_address.toString());
        expect(orders?.values()[0].fromAmount).toEqual(10n);
        expect(orders?.values()[0].toAddress.toString()).toEqual(user_order_jetton2_address.toString());
        expect(orders?.values()[0].toAmount).toEqual(20n);
    });
});