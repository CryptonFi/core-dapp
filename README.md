# crypton

Decentralized, permissionless protocol where users can create any token exchange orders.

## Project structure

-   `contracts` - source code of Master order and User order contracts and their dependencies. Also includes base jetton implementation.
-   `wrappers` - wrapper classes for the contracts.
-   `tests` - tests for the contracts.
-   `scripts` - scripts used by the project, mainly the deployment scripts.

## How to use

### Build Smart contracts

`yarn build` or `npm run build`

### Execute tests

`yarn test` or `npm run test`

### Deploy Master order contract

`yarn start deployOrder` or `npm run start deployOrder`
