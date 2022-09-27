## Testing

Running `yarn test` will run every test located in the `test/` folder. They
use [mocha](https://mochajs.org) and [chai](https://www.chaijs.com/)

## Linting and autoformat

You can check if your code style is correct by running `yarn lint`, and fix
it with `yarn lint:fix`.

# @cardstack/upgrade-manager

The upgrade manager allows managing a set of smart contracts deployed to a
chain, handling proxy upgrade and batched configuration application, with
tooling to support mangement with a M-of-N gnosis safe.

## Installation
TODO
<!-- 
<_A step-by-step guide on how to install the plugin_>

```bash
npm install <your npm package name> [list of peer dependencies]
```

Import the plugin in your `hardhat.config.js`:

```js
require("<your plugin npm package name>");
```

Or if you are using TypeScript, in your `hardhat.config.ts`:

```ts
import "<your plugin npm package name>";
```
 -->

## Tasks

TODO

<!-- <_A description of each task added by this plugin. If it just overrides internal 
tasks, this may not be needed_>

This plugin creates no additional tasks.

<_or_>

This plugin adds the _example_ task to Hardhat:
```
output of `npx hardhat help example`
```
 -->
## Environment extensions

TODO

<!-- <_A description of each extension to the Hardhat Runtime Environment_>

This plugin extends the Hardhat Runtime Environment by adding an `example` field
whose type is `ExampleHardhatRuntimeEnvironmentField`.
 -->
## Configuration

TODO

<!-- <_A description of each extension to the HardhatConfig or to its fields_>

This plugin extends the `HardhatUserConfig`'s `ProjectPathsUserConfig` object with an optional
`newPath` field.

This is an example of how to set it:

```js
module.exports = {
  paths: {
    newPath: "new-path"
  }
};
```
 -->
## Usage

TODO

<!-- <_A description of how to use this plugin. How to use the tasks if there are any, etc._>

There are no additional steps you need to take for this plugin to work.

Install it and access ethers through the Hardhat Runtime Environment anywhere
you need it (tasks, scripts, tests, etc).
 -->