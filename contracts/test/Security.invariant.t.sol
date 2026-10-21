// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {MaintenanceRegistry} from "../src/MaintenanceRegistry.sol";

/// @notice Хендлер для invariant-тестирования ПР №5 (вариант 8).
///         Движок Foundry вызывает его функции в случайном порядке, со случайными
///         аргументами и от случайных «актёров» (админ, инженер ТО, посторонний).
///         Хендлер фиксирует в ghost-переменных всё, что произошло на самом деле,
///         а инварианты сверяют это с состоянием контракта.
contract SecurityHandler is Test {
    MaintenanceRegistry public reg;
    address public admin;
    address public tech;
    address public stranger;

    bytes32 public immutable TECH;
    bytes32 public immutable ADMIN;

    // --- ghost-переменные ---
    uint256 public ghost_registrations;         // успешные регистрации
    bool public ghost_unauthorizedSuccess;       // I1: вызов без роли прошёл
    bool public ghost_registeredWhilePaused;     // I3: регистрация прошла на паузе
    uint256 public ghost_totalAtPause;           // totalRecords в момент постановки на паузу
    bytes32[] internal machines;
    mapping(bytes32 => bool) internal seen;

    uint256 public calls_register;
    uint256 public calls_revoke;
    uint256 public calls_pause;
    uint256 public calls_unpause;

    constructor(MaintenanceRegistry _reg, address _admin, address _tech, address _stranger) {
        reg = _reg;
        admin = _admin;
        tech = _tech;
        stranger = _stranger;
        TECH = _reg.TECHNICIAN_ROLE();
        ADMIN = _reg.ADMIN_ROLE();
    }

    function _actor(uint256 seed) internal view returns (address) {
        uint256 k = seed % 3;
        if (k == 0) return admin;
        if (k == 1) return tech;
        return stranger;
    }

    function machinesLength() external view returns (uint256) {
        return machines.length;
    }

    function machineAt(uint256 i) external view returns (bytes32) {
        return machines[i];
    }

    /// Регистрация этапа ТО от случайного актёра.
    function register(uint256 actorSeed, uint8 machineSeed, uint32 code, uint64 ts, bytes32 doc) external {
        calls_register++;
        address who = _actor(actorSeed);
        bytes32 m = bytes32(uint256(machineSeed) + 1); // не ноль, небольшое множество станков
        if (code == 0) code = 1;
        ts = uint64(bound(ts, 0, block.timestamp));
        bool wasPaused = reg.paused();
        bool authorized = reg.hasRole(TECH, who);

        vm.prank(who);
        try reg.registerService(m, code, ts, doc) {
            ghost_registrations++;
            if (!authorized) ghost_unauthorizedSuccess = true;
            if (wasPaused) ghost_registeredWhilePaused = true;
            if (!seen[m]) {
                seen[m] = true;
                machines.push(m);
            }
        } catch {}
    }

    /// Отзыв записи от случайного актёра.
    function revoke(uint256 actorSeed, uint256 idx) external {
        calls_revoke++;
        if (machines.length == 0) return;
        address who = _actor(actorSeed);
        bytes32 m = machines[idx % machines.length];
        bool authorized = reg.hasRole(ADMIN, who);
        vm.prank(who);
        try reg.revokeLastService(m) {
            if (!authorized) ghost_unauthorizedSuccess = true;
        } catch {}
    }

    /// Пауза от случайного актёра.
    function pause(uint256 actorSeed) external {
        calls_pause++;
        address who = _actor(actorSeed);
        bool authorized = reg.hasRole(ADMIN, who);
        vm.prank(who);
        try reg.pause() {
            if (!authorized) ghost_unauthorizedSuccess = true;
            ghost_totalAtPause = reg.totalRecords();
        } catch {}
    }

    /// Снятие паузы от случайного актёра.
    function unpause(uint256 actorSeed) external {
        calls_unpause++;
        address who = _actor(actorSeed);
        bool authorized = reg.hasRole(ADMIN, who);
        vm.prank(who);
        try reg.unpause() {
            if (!authorized) ghost_unauthorizedSuccess = true;
        } catch {}
    }
}

/// @title Три инварианта безопасности MaintenanceRegistry (ПР №5, Задание 2)
contract SecurityInvariantTest is Test {
    MaintenanceRegistry reg;
    SecurityHandler handler;

    address admin = makeAddr("admin");
    address tech = makeAddr("technician");
    address stranger = makeAddr("stranger");

    function setUp() public {
        vm.warp(1_790_000_000);
        reg = new MaintenanceRegistry(admin);
        bytes32 techRole = reg.TECHNICIAN_ROLE();
        vm.prank(admin);
        reg.grantRole(techRole, tech);

        handler = new SecurityHandler(reg, admin, tech, stranger);
        targetContract(address(handler));
    }

    /// I1. Авторизация: ни один вызов без нужной роли не изменил состояние
    ///     (регистрация — только TECHNICIAN_ROLE; отзыв и пауза — только ADMIN_ROLE),
    ///     а посторонний не получил ролей.
    function invariant_I1_OnlyAuthorizedRolesChangeState() public view {
        assertFalse(handler.ghost_unauthorizedSuccess(), "I1: unauthorized call changed state");
        assertFalse(reg.hasRole(reg.TECHNICIAN_ROLE(), stranger), "I1: stranger got TECHNICIAN_ROLE");
        assertFalse(reg.hasRole(reg.ADMIN_ROLE(), stranger), "I1: stranger got ADMIN_ROLE");
        assertFalse(reg.hasRole(reg.ADMIN_ROLE(), tech), "I1: technician got ADMIN_ROLE");
    }

    /// I2. Целостность учёта: totalRecords = число успешных регистраций
    ///     = сумма serviceCount по всем станкам.
    function invariant_I2_CountersConsistent() public view {
        uint256 sum;
        uint256 n = handler.machinesLength();
        for (uint256 i = 0; i < n; i++) {
            sum += reg.serviceCount(handler.machineAt(i));
        }
        assertEq(reg.totalRecords(), handler.ghost_registrations(), "I2: totalRecords != registrations");
        assertEq(reg.totalRecords(), sum, "I2: totalRecords != sum(serviceCount)");
    }

    /// I3. Пауза блокирует запись: на паузе не прошла ни одна регистрация,
    ///     и totalRecords не изменился с момента постановки на паузу.
    function invariant_I3_PauseBlocksWrites() public view {
        assertFalse(handler.ghost_registeredWhilePaused(), "I3: registration succeeded while paused");
        if (reg.paused()) {
            assertEq(reg.totalRecords(), handler.ghost_totalAtPause(), "I3: totalRecords changed during pause");
        }
    }

    /// Сводка вызовов после каждого прогона (видна с -vvv): подтверждает,
    /// что движок реально вызывал все функции хендлера.
    function afterInvariant() public view {
        console.log("calls register/revoke/pause/unpause:", handler.calls_register(), handler.calls_revoke(), handler.calls_pause());
        console.log("successful registrations:", handler.ghost_registrations(), "unpause calls:", handler.calls_unpause());
    }
}
