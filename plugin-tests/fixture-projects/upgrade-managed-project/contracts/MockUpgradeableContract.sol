pragma solidity ^0.8.17;
pragma abicoder v1;

contract MockUpgradeableContract {
  address public owner;

  function version() external pure returns (string memory) {
    return "1";
  }

  function initialize(address _owner) external {
    owner = _owner;
  }
}
