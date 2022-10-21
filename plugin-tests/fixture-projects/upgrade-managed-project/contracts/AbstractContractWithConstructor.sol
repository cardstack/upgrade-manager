pragma solidity ^0.8.17;
pragma abicoder v1;

contract AbstractContractWithConstructor {
  address public fooAddr;
  string public barString;

  constructor(address _fooAddr, string memory _barString) {
    fooAddr = _fooAddr;
    barString = _barString;
  }
}
