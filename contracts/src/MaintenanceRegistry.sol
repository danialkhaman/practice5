// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// @title MaintenanceRegistry — вариант 8 «Промышленность» (защищённая версия, ПР №3)
/// @notice Реестр этапов технического обслуживания оборудования с ролевым контролем доступа.
///         В блокчейне хранятся только идентификаторы, коды, время и ХЕШ документа-акта ТО;
///         сам акт (PDF/скан) хранится во внешнем защищённом хранилище off-chain.
contract MaintenanceRegistry is AccessControl, Pausable {
    // --- Роли (2 роли пользователей) ---
    /// @notice Роль инженера ТО: может регистрировать этапы обслуживания.
    bytes32 public constant TECHNICIAN_ROLE = keccak256("TECHNICIAN_ROLE");
    /// @notice Роль администратора системы: пауза, назначение ролей, отзыв записей.
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    // --- Данные, хранимые on-chain ---
    struct ServiceRecord {
        uint32 serviceCode;   // код этапа ТО
        uint64 timestamp;     // время этапа (Unix time)
        address technician;   // кто зарегистрировал
        bytes32 documentHash; // keccak256 акта ТО (off-chain), 0 = без документа
        bool revoked;         // запись отозвана администратором
    }

    uint256 public totalRecords;                           // общее число записей
    mapping(bytes32 => ServiceRecord) public lastService;  // станок -> последняя запись
    mapping(bytes32 => uint256) public serviceCount;       // станок -> число обслуживаний

    // --- События (2+) ---
    event ServiceRegistered(
        bytes32 indexed machineId,
        uint32 serviceCode,
        uint64 timestamp,
        bytes32 documentHash,
        address indexed technician
    );
    event ServiceRevoked(bytes32 indexed machineId, address indexed admin);

    // --- Пользовательские ошибки ---
    error InvalidServiceCode();
    error EmptyMachineId();
    error TimestampInFuture(uint64 provided, uint64 blockTime);
    error NothingToRevoke(bytes32 machineId);

    /// @param admin адрес, получающий роли ADMIN_ROLE и DEFAULT_ADMIN_ROLE при деплое
    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin); // может назначать/отзывать любые роли
        _grantRole(ADMIN_ROLE, admin);
        _grantRole(TECHNICIAN_ROLE, admin);    // деплоер по умолчанию ещё и инженер
    }

    /// @notice Зарегистрировать этап ТО. Только роль TECHNICIAN_ROLE, только когда не на паузе.
    function registerService(
        bytes32 machineId,
        uint32 serviceCode,
        uint64 timestamp,
        bytes32 documentHash
    ) external onlyRole(TECHNICIAN_ROLE) whenNotPaused {
        // --- Проверки входных данных (checks) ---
        if (machineId == bytes32(0)) revert EmptyMachineId();
        if (serviceCode == 0) revert InvalidServiceCode();
        if (timestamp > uint64(block.timestamp)) {
            revert TimestampInFuture(timestamp, uint64(block.timestamp));
        }

        // --- Изменение состояния (effects) ---
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
        // Внешних вызовов нет — переход управления недоверенному коду отсутствует.
    }

    /// @notice Отозвать последнюю запись станка. Только администратор.
    function revokeLastService(bytes32 machineId) external onlyRole(ADMIN_ROLE) {
        if (lastService[machineId].technician == address(0) || lastService[machineId].revoked) {
            revert NothingToRevoke(machineId);
        }
        lastService[machineId].revoked = true;
        emit ServiceRevoked(machineId, msg.sender);
    }

    /// @notice Поставить систему на паузу (аварийная остановка). Только администратор.
    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }

    /// @notice Снять паузу. Только администратор.
    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }

    /// @notice Прочитать последнюю запись станка (read-only).
    function getLastService(bytes32 machineId)
        external
        view
        returns (uint32 serviceCode, uint64 timestamp, address technician, bytes32 documentHash, bool revoked)
    {
        ServiceRecord memory r = lastService[machineId];
        return (r.serviceCode, r.timestamp, r.technician, r.documentHash, r.revoked);
    }

    /// @notice Проверить, что документ с данным содержимым соответствует записи станка.
    /// @dev off-chain считают keccak256(файла) и сверяют, не раскрывая сам файл в сети.
    function verifyDocument(bytes32 machineId, bytes32 documentHash) external view returns (bool) {
        return lastService[machineId].documentHash == documentHash
            && !lastService[machineId].revoked;
    }
}
