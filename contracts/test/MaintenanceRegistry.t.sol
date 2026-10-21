// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MaintenanceRegistry} from "../src/MaintenanceRegistry.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

contract MaintenanceRegistryTest is Test {
    MaintenanceRegistry reg;

    address admin = address(0xA11CE);
    address tech = address(0x7EC);      // инженер ТО
    address stranger = address(0xBAD);  // посторонний

    bytes32 constant M1 = bytes32("CNC-07");
    bytes32 constant DOC = keccak256("act-2026-09-30.pdf");
    bytes32 TECH_ROLE;
    bytes32 ADMIN_R;

    function setUp() public {
        reg = new MaintenanceRegistry(admin);
        TECH_ROLE = reg.TECHNICIAN_ROLE();
        ADMIN_R = reg.ADMIN_ROLE();
        vm.prank(admin);
        reg.grantRole(TECH_ROLE, tech);
    }

    // 1. Корректный сценарий: инженер регистрирует этап ТО.
    function test_RegisterService_Success() public {
        vm.prank(tech);
        reg.registerService(M1, 101, uint64(block.timestamp), DOC);

        (uint32 code, , address who, bytes32 doc, bool revoked) = reg.getLastService(M1);
        assertEq(code, 101);
        assertEq(who, tech);
        assertEq(doc, DOC);
        assertFalse(revoked);
        assertEq(reg.totalRecords(), 1);
        assertEq(reg.serviceCount(M1), 1);
    }

    // 2. Событие ServiceRegistered эмитится с правильными данными.
    function test_RegisterService_EmitsEvent() public {
        vm.expectEmit(true, true, false, true);
        emit MaintenanceRegistry.ServiceRegistered(M1, 101, uint64(block.timestamp), DOC, tech);
        vm.prank(tech);
        reg.registerService(M1, 101, uint64(block.timestamp), DOC);
    }

    // 3. Ошибка доступа: посторонний не может зарегистрировать ТО.
    function test_RegisterService_RevertIfNotTechnician() public {
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                stranger,
                TECH_ROLE
            )
        );
        reg.registerService(M1, 101, uint64(block.timestamp), DOC);
    }

    // 4. Некорректные данные: serviceCode == 0 откатывается.
    function test_RegisterService_RevertOnZeroCode() public {
        vm.prank(tech);
        vm.expectRevert(MaintenanceRegistry.InvalidServiceCode.selector);
        reg.registerService(M1, 0, uint64(block.timestamp), DOC);
    }

    // 5. Некорректные данные: пустой machineId откатывается.
    function test_RegisterService_RevertOnEmptyMachineId() public {
        vm.prank(tech);
        vm.expectRevert(MaintenanceRegistry.EmptyMachineId.selector);
        reg.registerService(bytes32(0), 101, uint64(block.timestamp), DOC);
    }

    // 6. Граничное значение: timestamp в будущем откатывается.
    function test_RegisterService_RevertOnFutureTimestamp() public {
        uint64 future = uint64(block.timestamp + 1);
        vm.prank(tech);
        vm.expectRevert(
            abi.encodeWithSelector(
                MaintenanceRegistry.TimestampInFuture.selector, future, uint64(block.timestamp)
            )
        );
        reg.registerService(M1, 101, future, DOC);
    }

    // 7. Отзыв записи: только администратор; инвариант статуса.
    function test_RevokeLastService_OnlyAdmin() public {
        vm.prank(tech);
        reg.registerService(M1, 101, uint64(block.timestamp), DOC);

        // Посторонний не может отозвать.
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                stranger,
                ADMIN_R
            )
        );
        reg.revokeLastService(M1);

        // Администратор может.
        vm.prank(admin);
        reg.revokeLastService(M1);
        (, , , , bool revoked) = reg.getLastService(M1);
        assertTrue(revoked);
    }

    // 8. Повторная операция: нельзя отозвать уже отозванную запись.
    function test_RevokeLastService_RevertOnDoubleRevoke() public {
        vm.prank(tech);
        reg.registerService(M1, 101, uint64(block.timestamp), DOC);
        vm.prank(admin);
        reg.revokeLastService(M1);

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(MaintenanceRegistry.NothingToRevoke.selector, M1));
        reg.revokeLastService(M1);
    }

    // 9. Пауза: на паузе регистрация откатывается, после снятия — работает.
    function test_Pause_BlocksRegister() public {
        vm.prank(admin);
        reg.pause();

        vm.prank(tech);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        reg.registerService(M1, 101, uint64(block.timestamp), DOC);

        vm.prank(admin);
        reg.unpause();
        vm.prank(tech);
        reg.registerService(M1, 101, uint64(block.timestamp), DOC);
        assertEq(reg.totalRecords(), 1);
    }

    // 10. Пауза: поставить на паузу может только администратор.
    function test_Pause_OnlyAdmin() public {
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                stranger,
                ADMIN_R
            )
        );
        reg.pause();
    }

    // 11. verifyDocument: сверка хеша документа off-chain.
    function test_VerifyDocument() public {
        vm.prank(tech);
        reg.registerService(M1, 101, uint64(block.timestamp), DOC);
        assertTrue(reg.verifyDocument(M1, DOC));
        assertFalse(reg.verifyDocument(M1, keccak256("other-file.pdf")));
    }

    // --- FUZZ-тесты (случайные входные данные) ---

    // 12. Fuzz: любая валидная запись от инженера корректно сохраняется.
    function testFuzz_RegisterService_StoresData(
        bytes32 machineId,
        uint32 serviceCode,
        uint64 ts,
        bytes32 doc
    ) public {
        vm.assume(machineId != bytes32(0));
        vm.assume(serviceCode != 0);
        ts = uint64(bound(ts, 0, block.timestamp));

        vm.prank(tech);
        reg.registerService(machineId, serviceCode, ts, doc);

        (uint32 code, uint64 t, address who, bytes32 d, ) = reg.getLastService(machineId);
        assertEq(code, serviceCode);
        assertEq(t, ts);
        assertEq(who, tech);
        assertEq(d, doc);
    }

    // 13. Fuzz: ни один адрес без роли TECHNICIAN_ROLE не может писать.
    function testFuzz_OnlyTechnicianCanRegister(address caller) public {
        vm.assume(caller != tech && caller != admin);
        vm.assume(!reg.hasRole(TECH_ROLE, caller));

        vm.prank(caller);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                caller,
                TECH_ROLE
            )
        );
        reg.registerService(M1, 101, uint64(block.timestamp), DOC);
    }
}
