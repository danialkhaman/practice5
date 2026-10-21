// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// @title MaintenanceRegistryVulnerable — УЯЗВИМАЯ версия из ПР №3 (Задание 3).
/// @dev В ПР №5 используется ТОЛЬКО как негативный контроль в интеграционных тестах:
///      проверка инвариантов по журналу должна обнаружить нарушение I1. В dApp не развёртывается.
/// @notice Содержит один контролируемый дефект: нарушение контроля доступа (Broken Access Control).
///         Эксперимент выполняется ТОЛЬКО локально/в тестовой сети.
/// @dev Отличие от защищённой версии ровно одно — см. revokeLastService ниже.
contract MaintenanceRegistryVulnerable is AccessControl, Pausable {
    bytes32 public constant TECHNICIAN_ROLE = keccak256("TECHNICIAN_ROLE");
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    struct ServiceRecord {
        uint32 serviceCode;
        uint64 timestamp;
        address technician;
        bytes32 documentHash;
        bool revoked;
    }

    uint256 public totalRecords;
    mapping(bytes32 => ServiceRecord) public lastService;
    mapping(bytes32 => uint256) public serviceCount;

    event ServiceRegistered(
        bytes32 indexed machineId,
        uint32 serviceCode,
        uint64 timestamp,
        bytes32 documentHash,
        address indexed technician
    );
    event ServiceRevoked(bytes32 indexed machineId, address indexed caller);

    error InvalidServiceCode();
    error EmptyMachineId();
    error TimestampInFuture(uint64 provided, uint64 blockTime);
    error NothingToRevoke(bytes32 machineId);

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
        _grantRole(TECHNICIAN_ROLE, admin);
    }

    // Эта функция защищена корректно.
    function registerService(
        bytes32 machineId,
        uint32 serviceCode,
        uint64 timestamp,
        bytes32 documentHash
    ) external onlyRole(TECHNICIAN_ROLE) whenNotPaused {
        if (machineId == bytes32(0)) revert EmptyMachineId();
        if (serviceCode == 0) revert InvalidServiceCode();
        if (timestamp > uint64(block.timestamp)) {
            revert TimestampInFuture(timestamp, uint64(block.timestamp));
        }
        lastService[machineId] = ServiceRecord({
            serviceCode: serviceCode,
            timestamp: timestamp,
            technician: msg.sender,
            documentHash: documentHash,
            revoked: false
        });
        serviceCount[machineId] += 1;
        totalRecords += 1;
        emit ServiceRegistered(machineId, serviceCode, timestamp, documentHash, msg.sender);
    }

    // >>> ДЕФЕКТ: административная функция БЕЗ проверки роли. <<<
    // Отсутствует модификатор onlyRole(ADMIN_ROLE): отозвать запись может любой адрес.
    // Нарушается инвариант «только ADMIN_ROLE изменяет статус записи».
    function revokeLastService(bytes32 machineId) external {
        if (lastService[machineId].technician == address(0) || lastService[machineId].revoked) {
            revert NothingToRevoke(machineId);
        }
        lastService[machineId].revoked = true;
        emit ServiceRevoked(machineId, msg.sender);
    }

    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }

    function getLastService(bytes32 machineId)
        external
        view
        returns (uint32 serviceCode, uint64 timestamp, address technician, bytes32 documentHash, bool revoked)
    {
        ServiceRecord memory r = lastService[machineId];
        return (r.serviceCode, r.timestamp, r.technician, r.documentHash, r.revoked);
    }
}
