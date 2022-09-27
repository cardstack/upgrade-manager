pragma solidity ^0.8.9;
pragma abicoder v1;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import "./UpgradeManager.sol";

contract UpgradeableContractV1 is OwnableUpgradeable {
  function initialize(address owner) external virtual initializer {
    __Ownable_init();
    if (_msgSender() != owner) {
      _transferOwnership(owner);
    }
  }

  function version() external pure returns (string memory) {
    return "1";
  }
}

contract UpgradeableContractV2 is OwnableUpgradeable {
  string public foo;

  function initialize(address owner) external virtual initializer {
    __Ownable_init();
    if (_msgSender() != owner) {
      _transferOwnership(owner);
    }
  }

  function version() external pure returns (string memory) {
    return "2";
  }

  function setup(string calldata _foo) external {
    foo = _foo;
  }
}

contract UpgradedUpgradeManager is UpgradeManager {
  function newFunction() external pure returns (string memory) {
    return "UpgradedUpgradeManager";
  }
}
