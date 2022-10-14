pragma solidity ^0.8.17;
pragma abicoder v1;

contract MockUpgradeableContract {
  address public owner;
  string public fooString;
  address public barAddress;

  function version() external pure returns (string memory) {
    return "1";
  }

  function initialize(address _owner) external {
    owner = _owner;
  }

  function setup(string memory _fooString, address _barAddress) external {
    fooString = _fooString;
    barAddress = _barAddress;
  }
}
