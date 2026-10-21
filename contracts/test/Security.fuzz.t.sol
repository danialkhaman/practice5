// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MaintenanceRegistry} from "../src/MaintenanceRegistry.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

/// @title Fuzz / property-тесты MaintenanceRegistry (ПР №5, Задание 2)
/// @notice Каждое свойство проверяется на тысячах случайных входов (runs в foundry.toml).
contract SecurityFuzzTest is Test {
    MaintenanceRegistry reg;
    address admin = makeAddr("admin");
    address tech = makeAddr("technician");
    bytes32 TECH;
    bytes32 ADMIN;

    function setUp() public {
        vm.warp(1_790_000_000);
        reg = new MaintenanceRegistry(admin);
        TECH = reg.TECHNICIAN_ROLE();
        ADMIN = reg.ADMIN_ROLE();
        vm.prank(admin);
        reg.grantRole(TECH, tech);
    }

    /// F1. Свойство авторизации: ЛЮБОЙ адрес без ролей получает AccessControlUnauthorizedAccount
    ///     на каждой изменяющей функции, и состояние не меняется.
    function testFuzz_F1_NoRoleCannotWrite(address caller, bytes32 m, uint32 code, uint64 ts) public {
        vm.assume(caller != admin && caller != tech && caller != address(0));
        ts = uint64(bound(ts, 0, block.timestamp));

        vm.startPrank(caller);
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, caller, TECH));
        reg.registerService(m, code, ts, bytes32(0));

        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, caller, ADMIN));
        reg.revokeLastService(m);

        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, caller, ADMIN));
        reg.pause();
        vm.stopPrank();

        assertEq(reg.totalRecords(), 0);
        assertFalse(reg.paused());
    }

    /// F2. Свойство корректности записи: после регистрации контракт возвращает ровно
    ///     переданные данные, verifyDocument принимает только этот хеш.
    function testFuzz_F2_RegisterRoundTrip(bytes32 m, uint32 code, uint64 ts, bytes32 doc, bytes32 other) public {
        vm.assume(m != bytes32(0) && code != 0);
        ts = uint64(bound(ts, 0, block.timestamp));

        vm.prank(tech);
        reg.registerService(m, code, ts, doc);

        (uint32 c, uint64 t, address who, bytes32 d, bool revoked) = reg.getLastService(m);
        assertEq(c, code);
        assertEq(t, ts);
        assertEq(who, tech);
        assertEq(d, doc);
        assertFalse(revoked);
        assertTrue(reg.verifyDocument(m, doc));
        if (other != doc) assertFalse(reg.verifyDocument(m, other));
        assertEq(reg.serviceCount(m), 1);
        assertEq(reg.totalRecords(), 1);
    }

    /// F3. Граничное свойство времени: любая метка из будущего (на 1 с и больше) отклоняется.
    function testFuzz_F3_FutureTimestampAlwaysReverts(uint64 delta) public {
        delta = uint64(bound(delta, 1, type(uint64).max - block.timestamp));
        uint64 future = uint64(block.timestamp) + delta;
        vm.prank(tech);
        vm.expectRevert(
            abi.encodeWithSelector(MaintenanceRegistry.TimestampInFuture.selector, future, uint64(block.timestamp))
        );
        reg.registerService(bytes32("CNC-07"), 101, future, bytes32(0));
    }
}
