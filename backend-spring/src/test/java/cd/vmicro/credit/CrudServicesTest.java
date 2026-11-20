package cd.vmicro.credit;

import cd.vmicro.credit.entity.AuditLogEntity;
import cd.vmicro.credit.entity.LoanContractEntity;
import cd.vmicro.credit.entity.RepaymentScheduleEntity;
import cd.vmicro.credit.entity.SavingsGoalEntity;
import cd.vmicro.credit.repository.AuditLogRepository;
import cd.vmicro.credit.repository.LoanContractRepository;
import cd.vmicro.credit.repository.RepaymentScheduleRepository;
import cd.vmicro.credit.repository.SavingsGoalRepository;
import cd.vmicro.credit.security.JwtAuthenticationFilter;
import cd.vmicro.credit.security.JwtService;
import cd.vmicro.credit.service.AuditLogService;
import cd.vmicro.credit.service.LoanContractService;
import cd.vmicro.credit.service.SavingsGoalService;
import cd.vmicro.credit.service.SolvencyService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class CrudServicesTest {

    private SavingsGoalRepository goalRepo;
    private LoanContractRepository contractRepo;
    private RepaymentScheduleRepository scheduleRepo;
    private AuditLogRepository auditRepo;
    private JdbcTemplate jdbc;
    private AuditLogService auditLogService;
    private SavingsGoalService savingsGoalService;
    private LoanContractService loanContractService;

    @BeforeEach
    void setup() {
        SecurityContextHolder.clearContext();
        goalRepo = mock(SavingsGoalRepository.class);
        contractRepo = mock(LoanContractRepository.class);
        scheduleRepo = mock(RepaymentScheduleRepository.class);
        auditRepo = mock(AuditLogRepository.class);
        jdbc = mock(JdbcTemplate.class);

        when(auditRepo.save(any(AuditLogEntity.class))).thenAnswer(inv -> inv.getArgument(0));
        when(goalRepo.save(any(SavingsGoalEntity.class))).thenAnswer(inv -> inv.getArgument(0));
        when(contractRepo.save(any(LoanContractEntity.class))).thenAnswer(inv -> inv.getArgument(0));
        when(scheduleRepo.save(any(RepaymentScheduleEntity.class))).thenAnswer(inv -> inv.getArgument(0));

        auditLogService = new AuditLogService(auditRepo);
        savingsGoalService = new SavingsGoalService(goalRepo, jdbc, auditLogService);
        loanContractService = new LoanContractService(contractRepo, scheduleRepo, new SolvencyService(), jdbc, auditLogService);
    }

    @Test
    void savingsGoalCrudBlocksDeleteWhenBalancePositiveAndAllowsAfterRelease() {
        SavingsGoalEntity created = savingsGoalService.createGoal(
                "usr_1", "Stock Boutique", "Commerce", BigDecimal.valueOf(300), LocalDate.of(2027, 6, 1)
        );
        assertEquals("ACTIVE", created.getStatus());
        assertEquals(BigDecimal.ZERO, created.getCurrentAmount());

        created.setCurrentAmount(BigDecimal.valueOf(75));
        when(goalRepo.findByIdAndUserIdAndStatusNot(created.getId(), "usr_1", "DELETED")).thenReturn(Optional.of(created));
        when(goalRepo.findByIdAndUserIdAndStatus(created.getId(), "usr_1", "ACTIVE")).thenReturn(Optional.of(created));

        ResponseStatusException conflict = assertThrows(ResponseStatusException.class,
                () -> savingsGoalService.deleteControlledGoal(created.getId(), "usr_1", "CLIENT"));
        assertEquals(HttpStatus.CONFLICT, conflict.getStatusCode());

        BigDecimal released = savingsGoalService.releaseGoalToAvailableBalance(created.getId(), "usr_1", "CLIENT");
        assertEquals(BigDecimal.valueOf(75), released);
        assertEquals(BigDecimal.ZERO, created.getCurrentAmount());

        savingsGoalService.deleteControlledGoal(created.getId(), "usr_1", "CLIENT");
        assertEquals("DELETED", created.getStatus());
        verify(auditRepo, atLeast(2)).save(any(AuditLogEntity.class));
    }

    @Test
    void loanContractServiceCreatesScheduleAndProcessesInstallmentPayment() {
        LoanContractEntity contract = loanContractService.createApprovedContractWithSchedule(
                "loan_1", "usr_1", BigDecimal.valueOf(600), 6
        );
        assertEquals("ACTIVE", contract.getStatus());
        verify(scheduleRepo, times(6)).save(any(RepaymentScheduleEntity.class));

        RepaymentScheduleEntity sched = new RepaymentScheduleEntity();
        sched.setId("sch_1");
        sched.setContractId(contract.getId());
        sched.setInstallmentNumber(1);
        sched.setTotalDue(BigDecimal.valueOf(111));
        sched.setStatus("PENDING");

        when(contractRepo.findByLoanApplicationIdAndUserId("loan_1", "usr_1")).thenReturn(Optional.of(contract));
        when(scheduleRepo.findByIdAndContractId("sch_1", contract.getId())).thenReturn(Optional.of(sched));

        Map<String, Object> paymentResult = loanContractService.recordInstallmentPayment(
                "loan_1", "usr_1", "sch_1", "AIRTEL_MONEY", "idem_1"
        );
        assertEquals("PAID", paymentResult.get("status"));
        assertEquals("PAID", sched.getStatus());
        assertTrue(contract.getRemainingBalance().compareTo(contract.getTotalRepayable()) < 0);
    }

    @Test
    void auditLogServiceRecordsWithJsonMetadata() {
        AuditLogEntity saved = auditLogService.recordAudit(
                "usr_admin", "SUPER_ADMIN", "LOAN_DECISION_APPROVED", "LOAN_APPLICATION", "loan_9", Map.of("amount", 500)
        );
        assertTrue(saved.getId().startsWith("aud_"));
        assertEquals("SUPER_ADMIN", saved.getActorRole());
        assertEquals(500, saved.getMetadataJson().get("amount"));
    }

    @Test
    void jwtFilterPopulatesSecurityContextWithRole() throws Exception {
        var jwtService = new JwtService("vmicro_unit_test_secret_at_least_32_characters", new ObjectMapper());
        var filter = new JwtAuthenticationFilter(jwtService);
        String token = jwtService.generateAccessToken("usr_agent", "CREDIT_AGENT", "ses_1", 3600);

        MockHttpServletRequest req = new MockHttpServletRequest();
        req.addHeader("Authorization", "Bearer " + token);
        MockHttpServletResponse res = new MockHttpServletResponse();

        filter.doFilter(req, res, new MockFilterChain());

        var auth = SecurityContextHolder.getContext().getAuthentication();
        assertNotNull(auth);
        assertEquals("usr_agent", auth.getName());
        assertTrue(auth.getAuthorities().stream().anyMatch(a -> a.getAuthority().equals("ROLE_CREDIT_AGENT")));
    }
}
