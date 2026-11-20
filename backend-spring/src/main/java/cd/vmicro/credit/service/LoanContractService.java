package cd.vmicro.credit.service;

import cd.vmicro.credit.entity.LoanContractEntity;
import cd.vmicro.credit.entity.RepaymentScheduleEntity;
import cd.vmicro.credit.repository.LoanContractRepository;
import cd.vmicro.credit.repository.RepaymentScheduleRepository;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@Service
public class LoanContractService {

    private final LoanContractRepository contractRepository;
    private final RepaymentScheduleRepository scheduleRepository;
    private final SolvencyService solvencyService;
    private final JdbcTemplate jdbc;
    private final AuditLogService auditLogService;

    public LoanContractService(
            LoanContractRepository contractRepository,
            RepaymentScheduleRepository scheduleRepository,
            SolvencyService solvencyService,
            JdbcTemplate jdbc,
            AuditLogService auditLogService
    ) {
        this.contractRepository = contractRepository;
        this.scheduleRepository = scheduleRepository;
        this.solvencyService = solvencyService;
        this.jdbc = jdbc;
        this.auditLogService = auditLogService;
    }

    @Transactional(readOnly = true)
    public List<LoanContractEntity> listUserContracts(String userId) {
        return contractRepository.findByUserIdOrderByDisbursedAtDesc(userId);
    }

    @Transactional(readOnly = true)
    public List<LoanContractEntity> listActiveUserContracts(String userId) {
        return contractRepository.findByUserIdAndStatus(userId, "ACTIVE");
    }

    @Transactional(readOnly = true)
    public List<LoanContractEntity> listAllContractsAdmin() {
        return contractRepository.findAllByOrderByDisbursedAtDesc();
    }

    @Transactional(readOnly = true)
    public LoanContractEntity getContractForUser(String contractId, String userId) {
        return contractRepository.findByIdAndUserId(contractId, userId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Contrat introuvable."));
    }

    @Transactional(readOnly = true)
    public LoanContractEntity getContractByIdAdmin(String contractId) {
        return contractRepository.findById(contractId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Contrat introuvable."));
    }

    @Transactional(readOnly = true)
    public Optional<LoanContractEntity> findByApplicationId(String loanApplicationId) {
        return contractRepository.findByLoanApplicationId(loanApplicationId);
    }

    @Transactional(readOnly = true)
    public List<RepaymentScheduleEntity> getSchedules(String contractId) {
        return scheduleRepository.findByContractIdOrderByInstallmentNumberAsc(contractId);
    }

    @Transactional(readOnly = true)
    public List<RepaymentScheduleEntity> getNextPendingSchedules(String contractId) {
        return scheduleRepository.findTop3ByContractIdAndStatusOrderByInstallmentNumberAsc(contractId, "PENDING");
    }

    @Transactional
    public LoanContractEntity createApprovedContractWithSchedule(
            String loanApplicationId,
            String applicantUserId,
            BigDecimal requestedAmount,
            int durationMonths
    ) {
        var est = solvencyService.calculateLoanEstimate(requestedAmount, durationMonths);
        OffsetDateTime now = OffsetDateTime.now();

        LoanContractEntity contract = new LoanContractEntity();
        contract.setId("ctr_" + UUID.randomUUID().toString().substring(0, 10));
        contract.setLoanApplicationId(loanApplicationId);
        contract.setUserId(applicantUserId);
        contract.setPrincipalAmount(est.requestedAmount());
        contract.setAnnualInterestRate(est.annualInterestRate());
        contract.setDurationMonths(est.durationMonths());
        contract.setMonthlyInstallment(est.monthlyInstallment());
        contract.setTotalRepayable(est.totalRepayable());
        contract.setRemainingBalance(est.totalRepayable());
        contract.setStatus("ACTIVE");
        contract.setDisbursedAt(now);
        contract.setIsSimulated(Boolean.TRUE);

        LoanContractEntity saved = contractRepository.save(contract);

        for (var item : est.schedulePreview()) {
            RepaymentScheduleEntity sched = new RepaymentScheduleEntity();
            sched.setId("sch_" + UUID.randomUUID().toString().substring(0, 10));
            sched.setContractId(saved.getId());
            sched.setInstallmentNumber(item.installmentNumber());
            sched.setDueDate(LocalDate.now().plusMonths(item.installmentNumber()));
            sched.setPrincipalDue(item.principalDue());
            sched.setInterestDue(item.interestDue());
            sched.setTotalDue(item.totalDue());
            sched.setPaidAmount(BigDecimal.ZERO);
            sched.setStatus("PENDING");
            scheduleRepository.save(sched);
        }
        return saved;
    }

    @Transactional
    public LoanContractEntity updateContractStatus(String contractId, String newStatus, String actorId, String actorRole) {
        if (!List.of("ACTIVE", "COMPLETED", "DEFAULTED", "RESTRUCTURED").contains(newStatus)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Statut de contrat invalide.");
        }
        LoanContractEntity contract = getContractByIdAdmin(contractId);
        contract.setStatus(newStatus);
        LoanContractEntity updated = contractRepository.save(contract);
        auditLogService.recordAudit(actorId, actorRole, "LOAN_CONTRACT_STATUS_UPDATED", "LOAN_CONTRACT", contractId, Map.of("status", newStatus));
        return updated;
    }

    @Transactional
    public Map<String, Object> recordInstallmentPayment(
            String loanApplicationId,
            String userId,
            String scheduleId,
            String provider,
            String idempotencyKey
    ) {
        LoanContractEntity contract = contractRepository.findByLoanApplicationIdAndUserId(loanApplicationId, userId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Contrat introuvable."));

        RepaymentScheduleEntity sched = scheduleRepository.findByIdAndContractId(scheduleId, contract.getId())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Échéance introuvable."));

        if ("PAID".equals(sched.getStatus())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Cette échéance est déjà réglée.");
        }

        BigDecimal totalDue = sched.getTotalDue();
        BigDecimal remaining = contract.getRemainingBalance().subtract(totalDue).max(BigDecimal.ZERO);
        String newStatus = remaining.compareTo(BigDecimal.valueOf(0.01)) <= 0 ? "COMPLETED" : "ACTIVE";
        String ref = "REP-SIM-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase();

        jdbc.update(
                "INSERT INTO payment_references (reference, idempotency_key, user_id, provider, operation_type, amount, currency, loan_id, external_ref, status, is_simulated, reconciled) VALUES (?, ?, ?, ?, 'LOAN_REPAYMENT', ?, 'USD', ?, ?, 'CONFIRMED', TRUE, TRUE)",
                ref, idempotencyKey, userId, provider, totalDue, loanApplicationId, "EXT-" + ref
        );

        sched.setPaidAmount(totalDue);
        sched.setStatus("PAID");
        sched.setPaidAt(OffsetDateTime.now());
        scheduleRepository.save(sched);

        contract.setRemainingBalance(remaining);
        contract.setStatus(newStatus);
        contractRepository.save(contract);

        jdbc.update(
                "INSERT INTO repayments (id, contract_id, schedule_id, user_id, amount, payment_reference, provider, is_simulated) VALUES (?, ?, ?, ?, ?, ?, ?, TRUE)",
                "rep_" + UUID.randomUUID().toString().substring(0, 10), contract.getId(), scheduleId, userId, totalDue, ref, provider
        );
        jdbc.update(
                "INSERT INTO transactions (id, user_id, loan_id, payment_reference, type, amount, currency, provider, status, description, is_simulated) VALUES (?, ?, ?, ?, 'LOAN_REPAYMENT', ?, 'USD', ?, 'CONFIRMED', ?, TRUE)",
                "tx_" + UUID.randomUUID().toString().substring(0, 10), userId, loanApplicationId, ref, totalDue, provider,
                "Remboursement échéance #" + sched.getInstallmentNumber() + " via " + provider + " (Simulation)"
        );

        return Map.of("reference", ref, "amountPaid", totalDue, "status", "PAID", "isSimulated", true);
    }
}
