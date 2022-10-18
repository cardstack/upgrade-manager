pragma solidity 0.8.17;
pragma abicoder v1;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

contract Ownable is OwnableUpgradeable {
  function initialize(address owner) external virtual initializer {
    __Ownable_init();
    _transferOwnership(owner);
  }
}
