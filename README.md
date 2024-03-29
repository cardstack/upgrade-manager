# @cardstack/upgrade-manager

The upgrade manager allows managing a set of smart contracts deployed to a
chain, handling proxy upgrade and batched configuration application, with
tooling to support management with a M-of-N gnosis safe.

Currently supported are OpenZepplin transparent ugpradeable proxy contracts
and implementations, along with the concept of "abstract contracts", which
can be used as non-upgradeable implementations for when different proxy
mechanisms are in use, a common example being Gnosis Safe delegate
implementations, or any other custom DELEGATECALL mechanism. 


## Architecture

The upgrade manager consists of:


### UpgradeManager.sol

A solidity contract that you deploy once  per chain for your hardhat project.

The UpgradeManager is owned by either an EOA or a Gnosis safe(recommended). It
becomes the owner of all your other contracts along with the owner of their
ProxyAdmin contracts.

This assumes that your upgradeable contracts support this interface:
```solidity
interface Ownable {
  function owner() public view returns (address);
  function transferOwnership(address newOwner) public;
}
```

Once the contracts are owned by the upgrade manager, the upgrade manager is
responsible for both upgrading their implementation, and calling arbitrary
config methods on them.

To propose an upgrade or a config method call, or both at the same time, a set
of upgrade proposers can call the `proposeUpgrade`, `proposeCall`, and
`proposeUpgradeAndCall` methods respectively. The upgrade proposers can be
accounts that have a lower level of trust than the upgrade manager owner. For
example, on a development team, all the developers could be proposers,
allowing them to stage changes without those changes taking effect yet.

Once the upgrades and calls are all proposed, then the owner of the upgrade
manager must approve all of these changes. This could be a single EOA but for
production usage, a gnosis safe owner is recommended with a suitable M-of-N
owner and threshold configuration.

The changes are applied atomically, so if you have multiple contracts which
depend on each other and need to be configured with each others' addresses,
there is no point-in-time where your projects contracts are partially
configured or partially upgraded. Either all are upgraded and configured, or
none are, from the perspective of any external transaction (note - if you use
call or upgradeAndCall, then this may not be true for those internal
transactions so you should be careful with what you do in those functions).

The only limit to the amount of changes that can be applied atomically is the
block gas limit, and if the gas usage is too large then changes can be easily
withdrawn to reduce gas usage.

### Hardhat plugin

The hardhat plugin is responsible for handling upgrades and configuration of
the contracts in your hardhat project.

You configure in your hardhat config file a list of the contracts you want to
deploy, and you also add a config directory with a js or ts file for each
contract you want to configure. When you run the provided `hardhat deploy`
task, the plugin will check the current on-chain state and bytecode,
compare it to your local code and configuration, and generate the set of
changes needed for the blockchain state to be what is required. The scripts
will then make the appropriate transactions to the UpgradeManager contract
to stage these upgrades and configration.

The current state of your configured contracts can be shown with the
`hardhat deploy:status` command:

```
$ hardhat deploy:status
┌───────────────────────────────┬─────────────────────────┬────────────────────────────────────────────┬────────────────────────────────────────────┬────────────────────────────────────────────┬─────────────────────────────────────────────────────────────────────┬────────────────────────┐
│ Contract ID                   │ Contract Name           │ Proxy Address                              │ Current Implementation Address             │ Proposed Implementation Address            │ Proposed Function Call                                              │ Local Bytecode Changed │
├───────────────────────────────┼─────────────────────────┼────────────────────────────────────────────┼────────────────────────────────────────────┼────────────────────────────────────────────┼─────────────────────────────────────────────────────────────────────┼────────────────────────┤
│ MockUpgradeableContract       │ MockUpgradeableContract │ 0x5FC8d32690cc91D4c39d9d3abcBD16989F875707 │ 0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9 │                                            │ setup(                                                              │                        │
│                               │                         │                                            │                                            │                                            │   string _fooString: "foo string value",                            │                        │
│                               │                         │                                            │                                            │                                            │   address _barAddress: "0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6" │                        │
│                               │                         │                                            │                                            │                                            │ )                                                                   │                        │
├───────────────────────────────┼─────────────────────────┼────────────────────────────────────────────┼────────────────────────────────────────────┼────────────────────────────────────────────┼─────────────────────────────────────────────────────────────────────┼────────────────────────┤
│ MockUpgradeableSecondInstance │ MockUpgradeableContract │ 0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6 │ 0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9 │                                            │ setup(                                                              │                        │
│                               │                         │                                            │                                            │                                            │   string _fooString: "foo string value second hardhat",             │                        │
│                               │                         │                                            │                                            │                                            │   address _barAddress: "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707" │                        │
│                               │                         │                                            │                                            │                                            │ )                                                                   │                        │
├───────────────────────────────┼─────────────────────────┼────────────────────────────────────────────┼────────────────────────────────────────────┼────────────────────────────────────────────┼─────────────────────────────────────────────────────────────────────┼────────────────────────┤
│ AbstractContract              │ AbstractContract        │                                            │ N/A (proposed)                             │ 0x610178dA211FEF7D417bC0e6FeD39F05609AD788 │                                                                     │ YES                    │
├───────────────────────────────┼─────────────────────────┼────────────────────────────────────────────┼────────────────────────────────────────────┼────────────────────────────────────────────┼─────────────────────────────────────────────────────────────────────┼────────────────────────┤
│ DeterministicContract         │ AbstractContract        │                                            │ N/A (proposed)                             │ 0xA51c1fc2f0D1a1b8494Ed1FE312d7C3a78Ed91C0 │                                                                     │ YES                    │
└───────────────────────────────┴─────────────────────────┴────────────────────────────────────────────┴────────────────────────────────────────────┴────────────────────────────────────────────┴─────────────────────────────────────────────────────────────────────┴────────────────────────┘
```

The diff between local / proposed code and on-chain code can also be displayed with the `hardhat deploy:diff:local` and `hardhat deploy:diff:proposed` commands.

If everything looks good, the upgrade manager owner can use the `hardhat
deploy:upgrade` command to execute all proposed changes atomically. If the
upgrade manager is owned by a gnosis safe, this is automatically detected and
instead of submitting the transaction, json with the current and previous
users' signatures is output, allowing the next owner to add their signature
until enough are collected to meet the safe's threshold

## Installation

```bash
npm install @cardstack/upgrade-manager
```

Import the plugin in your `hardhat.config.js`:

```js
require("@cardstack/upgrade-manager");
```

Or if you are using TypeScript, in your `hardhat.config.ts`:

```ts
import "@cardstack/upgrade-manager";
```

## Hardhat Configuration

This plugin extends the `HardhatUserConfig` object with the upgradeManager field.

This is an example of how to set it:

```js
module.exports = {
  upgradeManager: {
    contracts: [
      "FooContract",
      {
        id: "FooContractWithDifferentId",
        contract: "FooContract",
      },
      {
        id: "AbstractContract",
        abstract: true,
      },
      {
        id: "DeterministicContract",
        contract: "AbstractContract",
        abstract: true,
        deterministic: true,
      },
    ],
  },
};
```


Each item in the contracts array can either be a string, to simply deploy an
upgadeable proxy with the same id as the contract's name, or an object
representing configuration of the contract. The options are as follows:

* `id`: The arbitrary id you choose to reference this contract. Must be unique.
* `contract`: The name of the contract from your projects artifacts. You can deploy multiple instances of the same contract with different ids if required
* `abstract`: Deploy an abstract contract instead of an upgradeable proxy. Abstract contracts do not have config and are intended to be "implementation only", so that you can set an implementation for e.g. a safe delegate implementation or another type of DELEGATECALL proxy mechanism
* `deterministic`: "Deploy to a stable address based on the contract bytecode using [deterministic-deployment-proxy](https://github.com/Arachnid/deterministic-deployment-proxy). Only supported for abstract contracts"


## Deploy command


```
Usage: hardhat [GLOBAL OPTIONS] deploy [--auto-confirm <BOOLEAN>] [--derivation-path <STRING>] [--dry-run <BOOLEAN>] [--fork <STRING>] [--immediate-config-apply <BOOLEAN>] [--impersonate-address <STRING>]

OPTIONS:

  --auto-confirm            Don't ask for confirmation, useful in scripts / tests (default: false)
  --derivation-path         Derivation path to use when using mnemonic or trezor
  --dry-run                 Preview what would happen, without actually writing to the blockchain (default: false)
  --fork                    The network to fork
  --immediate-config-apply  If there are a large series of calls e.g. during initial setup, apply config immediately by calling methods directly on contracts instead of proposing config changes (default: false)
  --impersonate-address     Address to impersonate deploying from (usually only makes sense whilst forking)

deploy: Deploys new contracts and propose implementation and config changes for existing deployed contracts
```

### Example

```
hardhat deploy --network goerli
```

### Forking Example

This will run the deploy against an in-memory fork so you can preview changes. This assumes you have an rpc url configured correctly for this network in your hardhat config

```
hardhat deploy --fork goerli --impersonate-address $UPGRADE_MANAGER_OWNER_ADDRESS
```


### Forking with a persistant node

You may want to preview multiple steps against a fork. To acheive this, first start a forked node:

```sh
hardhat node --fork $RPC_URL
```

Then run multiple commands against the forked node:

```sh
hardhat deploy --network localhost --fork goerli --impersonate-address $UPGRADE_MANAGER_OWNER_ADDRESS
hardhat deploy:upgrade --network localhost --fork goerli --impersonate-address $UPGRADE_MANAGER_OWNER_ADDRESS
```


## `deploy:upgrade` command

Usage: hardhat [GLOBAL OPTIONS] deploy:upgrade [--auto-confirm <BOOLEAN>] [--derivation-path <STRING>] [--fork <STRING>] [--impersonate-address <STRING>] [--mnemonic <STRING>] [--prior-signatures <STRING>] newVersion

OPTIONS:

  --auto-confirm        Don't ask for confirmation, useful in scripts / tests (default: false)
  --derivation-path     Derivation path to use when using mnemonic or trezor
  --fork                The network to fork
  --impersonate-address Address to impersonate deploying from (usually only makes sense whilst forking)
  --mnemonic            Mnemonic to use for deploy actions
  --prior-signatures    Prior safe signatures collected for this operation

POSITIONAL ARGUMENTS:

  newVersion  The new version number to set on the upgrade manager. Does not have to increase or change

deploy:upgrade: Applies pending contract upgrades and config changes atomically


## Contract configuration

For each contract id above that you want to configure, add a file in the `config/` subdirectory of your hardhat project, for example:

```typescript
import { ConfigFunction } from "@cardstack/upgrade-manager/types";

let config: ConfigFunction = async function ({ address }) {
  return {
    setup: [
      { getter: "fooString", value: "foo string value" },
      {
        getter: "barAddress",
        value: address("MockUpgradeableSecondInstance"),
      },
    ],
  };
};

export default config;
```

or in javascript:


```javascript
module.exports = async function ({ address, deployConfig }) {
  return {
    setup: [
      {
        getter: "fooString",
        value: `foo string value second ${deployConfig.network}`,
      },
      {
        getter: "barAddress",
        value: address("MockUpgradeableContract"),
      },
    ],
  };
};
````

The keys of the exported objects each represent a config function that should be called on your contract.

The values for each key is an array of the paramaters to your setup function.
The `getter` field is a function to call on your contract to check the current
on-chain value. The `value` field is what the value should be set to after
configuration is complete.

You can use the `deployConfig.network` field passed in to the config function
if different configuration is required based on network. The hre is also a
property of deployConfig, so you can switch based on other hardhat
environment settings too.

This expects roughly the following configuration pattern in your contracts:

```
contract MockUpgradeableContract {
  string public fooString;
  address public barAddress;

  function setup(string memory _fooString, address _barAddress) external {
    fooString = _fooString;
    barAddress = _barAddress;
  }
}

```

The reason to use a single setter method instead of a setter for each
property is to avoid contract-bloat with many setter functions. Usually this
would be inconvenient to manually manage, however with the automated
configuration provided by the UpgradeManager this optimisation is no longer
inconvenient to use


## Adding and removing upgrade proposers

### deploy:add-proposer

Usage: hardhat [GLOBAL OPTIONS] deploy:add-proposer [--auto-confirm <BOOLEAN>] [--derivation-path <STRING>] [--fork <STRING>] [--impersonate-address <STRING>] [--mnemonic <STRING>] [--prior-signatures <STRING>] proposerAddress

OPTIONS:

  --auto-confirm        Don't ask for confirmation, useful in scripts / tests (default: false)
  --derivation-path     Derivation path to use when using mnemonic or trezor
  --fork                The network to fork
  --impersonate-address Address to impersonate deploying from (usually only makes sense whilst forking)
  --mnemonic            Mnemonic to use for deploy actions
  --prior-signatures    Prior safe signatures collected for this operation

POSITIONAL ARGUMENTS:

  proposerAddress The proposer address to add

deploy:add-proposer: Adds a proposer

### deploy:remove-proposer

Usage: hardhat [GLOBAL OPTIONS] deploy:remove-proposer [--auto-confirm <BOOLEAN>] [--derivation-path <STRING>] [--fork <STRING>] [--impersonate-address <STRING>] [--mnemonic <STRING>] [--prior-signatures <STRING>] proposerAddress

OPTIONS:

  --auto-confirm        Don't ask for confirmation, useful in scripts / tests (default: false)
  --derivation-path     Derivation path to use when using mnemonic or trezor
  --fork                The network to fork
  --impersonate-address Address to impersonate deploying from (usually only makes sense whilst forking)
  --mnemonic            Mnemonic to use for deploy actions
  --prior-signatures    Prior safe signatures collected for this operation

POSITIONAL ARGUMENTS:

  proposerAddress The proposer address to remove

deploy:remove-proposer: Removes a proposer

## Gnosis Safe Ownership of upgrade manager

It is recommended that after initial deploy, you transfer ownership of the upgrade manager to a gnosis safe.


### deploy:safe-setup

Usage: hardhat [GLOBAL OPTIONS] deploy:safe-setup [--auto-confirm <BOOLEAN>] [--derivation-path <STRING>] [--fork <STRING>] [--impersonate-address <STRING>] [--mnemonic <STRING>] [--prior-signatures <STRING>] newSafeOwners [newSafeThreshold]

OPTIONS:

  --auto-confirm        Don't ask for confirmation, useful in scripts / tests (default: false)
  --derivation-path     Derivation path to use when using mnemonic or trezor
  --fork                The network to fork
  --impersonate-address Address to impersonate deploying from (usually only makes sense whilst forking)
  --mnemonic            Mnemonic to use for deploy actions
  --prior-signatures    Prior safe signatures collected for this operation

POSITIONAL ARGUMENTS:

  newSafeOwners     The new owners of the safe, comma seperated addresses
  newSafeThreshold  The new threshold for the safe (default: 1)

deploy:safe-setup: Setup a new Gnosis Safe contract and transfer ths ownership of the upgrade manager to the new safe

### deploy:add-safe-owner

Usage: hardhat [GLOBAL OPTIONS] deploy:add-safe-owner [--auto-confirm <BOOLEAN>] [--derivation-path <STRING>] [--fork <STRING>] [--impersonate-address <STRING>] [--mnemonic <STRING>] [--new-safe-threshold <INT>] [--prior-signatures <STRING>] newSafeOwnerAddress

OPTIONS:

  --auto-confirm        Don't ask for confirmation, useful in scripts / tests (default: false)
  --derivation-path     Derivation path to use when using mnemonic or trezor
  --fork                The network to fork
  --impersonate-address Address to impersonate deploying from (usually only makes sense whilst forking)
  --mnemonic            Mnemonic to use for deploy actions
  --new-safe-threshold  The new threshold for the safe, if it changes
  --prior-signatures    Prior safe signatures collected for this operation

POSITIONAL ARGUMENTS:

  newSafeOwnerAddress The safe owner address to add

deploy:add-safe-owner: Adds a safe owner

### deploy:remove-safe-owner

Usage: hardhat [GLOBAL OPTIONS] deploy:remove-safe-owner [--auto-confirm <BOOLEAN>] [--derivation-path <STRING>] [--fork <STRING>] [--impersonate-address <STRING>] [--mnemonic <STRING>] [--new-safe-threshold <INT>] [--prior-signatures <STRING>] removeSafeOwnerAddress

OPTIONS:

  --auto-confirm        Don't ask for confirmation, useful in scripts / tests (default: false)
  --derivation-path     Derivation path to use when using mnemonic or trezor
  --fork                The network to fork
  --impersonate-address Address to impersonate deploying from (usually only makes sense whilst forking)
  --mnemonic            Mnemonic to use for deploy actions
  --new-safe-threshold  The new threshold for the safe, if it changes
  --prior-signatures    Prior safe signatures collected for this operation

POSITIONAL ARGUMENTS:

  removeSafeOwnerAddress  The safe owner address to remove

deploy:remove-safe-owner: Removes a safe owner

### deploy:set-safe-threshold

Usage: hardhat [GLOBAL OPTIONS] deploy:set-safe-threshold [--auto-confirm <BOOLEAN>] [--derivation-path <STRING>] [--fork <STRING>] [--impersonate-address <STRING>] [--mnemonic <STRING>] [--prior-signatures <STRING>] newSafeThreshold

OPTIONS:

  --auto-confirm        Don't ask for confirmation, useful in scripts / tests (default: false)
  --derivation-path     Derivation path to use when using mnemonic or trezor
  --fork                The network to fork
  --impersonate-address Address to impersonate deploying from (usually only makes sense whilst forking)
  --mnemonic            Mnemonic to use for deploy actions
  --prior-signatures    Prior safe signatures collected for this operation

POSITIONAL ARGUMENTS:

  newSafeThreshold  The new threshold for the safe

deploy:set-safe-threshold: Sets the threshold for a safe

## Testing

Running `yarn test` will run the solidity tests along with the plugin tests

## Linting and autoformat

You can check if your code style is correct by running `yarn lint`, and fix
it with `yarn lint:fix`.

