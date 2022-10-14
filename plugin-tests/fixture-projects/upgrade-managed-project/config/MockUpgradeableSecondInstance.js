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
