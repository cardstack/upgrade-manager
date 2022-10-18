pragma solidity 0.8.17;
pragma abicoder v1;

interface IAdminUpgradeabilityProxy {
  event Upgraded(address indexed implementation);
  event AdminChanged(address previousAdmin, address newAdmin);
}
