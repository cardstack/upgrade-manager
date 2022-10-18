pragma solidity ^0.8.17;
pragma abicoder v1;

contract AbstractContract {
  function version() external pure returns (string memory) {
    return "1";
  }
}
