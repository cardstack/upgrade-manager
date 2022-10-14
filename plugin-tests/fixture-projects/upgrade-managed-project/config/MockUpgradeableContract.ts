import { ConfigFunction } from "../../../../src/types";

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
