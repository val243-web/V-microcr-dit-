package cd.vmicro.credit.service;

import cd.vmicro.credit.entity.SavingsGoalEntity;
import cd.vmicro.credit.repository.SavingsGoalRepository;
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
import java.util.UUID;

@Service
public class SavingsGoalService {

    private final SavingsGoalRepository goalRepository;
    private final JdbcTemplate jdbc;
    private final AuditLogService auditLogService;

    public SavingsGoalService(
            SavingsGoalRepository goalRepository,
            JdbcTemplate jdbc,
            AuditLogService auditLogService
    ) {
        this.goalRepository = goalRepository;
        this.jdbc = jdbc;
        this.auditLogService = auditLogService;
    }

    @Transactional(readOnly = true)
    public List<SavingsGoalEntity> listActiveGoals(String userId) {
        return goalRepository.findByUserIdAndStatusNotOrderByCreatedAtDesc(userId, "DELETED");
    }

    @Transactional(readOnly = true)
    public SavingsGoalEntity getGoalForUser(String goalId, String userId) {
        return goalRepository.findByIdAndUserIdAndStatusNot(goalId, userId, "DELETED")
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Objectif introuvable."));
    }

    @Transactional
    public SavingsGoalEntity createGoal(
            String userId,
            String title,
            String category,
            BigDecimal targetAmount,
            LocalDate targetDate
    ) {
        OffsetDateTime now = OffsetDateTime.now();
        SavingsGoalEntity goal = new SavingsGoalEntity();
        goal.setId("goal_" + UUID.randomUUID().toString().substring(0, 10));
        goal.setUserId(userId);
        goal.setTitle(title.trim());
        goal.setCategory(category.trim());
        goal.setTargetAmount(targetAmount);
        goal.setCurrentAmount(BigDecimal.ZERO);
        goal.setTargetDate(targetDate);
        goal.setStatus("ACTIVE");
        goal.setCreatedAt(now);
        goal.setUpdatedAt(now);

        SavingsGoalEntity saved = goalRepository.save(goal);
        jdbc.update(
                "INSERT INTO notifications (id, user_id, category, title, message, read) VALUES (?, ?, 'SAVINGS_GOAL', 'Nouvel objectif créé', ?, FALSE)",
                "ntf_" + UUID.randomUUID().toString().substring(0, 10),
                userId,
                "Objectif « " + saved.getTitle() + " » (" + saved.getTargetAmount() + " USD) créé."
        );
        return saved;
    }

    @Transactional
    public SavingsGoalEntity updateGoal(
            String goalId,
            String userId,
            String title,
            String category,
            BigDecimal targetAmount,
            LocalDate targetDate
    ) {
        SavingsGoalEntity goal = getGoalForUser(goalId, userId);
        if (title != null && !title.isBlank()) goal.setTitle(title.trim());
        if (category != null && !category.isBlank()) goal.setCategory(category.trim());
        if (targetAmount != null && targetAmount.compareTo(BigDecimal.ZERO) > 0) goal.setTargetAmount(targetAmount);
        if (targetDate != null) goal.setTargetDate(targetDate);
        goal.setUpdatedAt(OffsetDateTime.now());
        return goalRepository.save(goal);
    }

    @Transactional
    public BigDecimal releaseGoalToAvailableBalance(String goalId, String userId, String actorRole) {
        SavingsGoalEntity goal = goalRepository.findByIdAndUserIdAndStatus(goalId, userId, "ACTIVE")
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Objectif introuvable."));

        BigDecimal amount = goal.getCurrentAmount();
        if (amount == null || amount.compareTo(BigDecimal.ZERO) <= 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Aucun solde à transférer.");
        }

        goal.setCurrentAmount(BigDecimal.ZERO);
        goal.setUpdatedAt(OffsetDateTime.now());
        goalRepository.save(goal);

        jdbc.update(
                "UPDATE savings_accounts SET available_balance = available_balance + ?, locked_goals_balance = GREATEST(0, locked_goals_balance - ?), updated_at = NOW() WHERE user_id = ?",
                amount, amount, userId
        );
        jdbc.update(
                "INSERT INTO transactions (id, user_id, goal_id, type, amount, currency, provider, status, description, is_simulated) VALUES (?, ?, ?, 'GOAL_RELEASE', ?, 'USD', 'INTERNAL_LEDGER', 'CONFIRMED', ?, TRUE)",
                "tx_" + UUID.randomUUID().toString().substring(0, 10),
                userId,
                goal.getId(),
                amount,
                "Libération objectif « " + goal.getTitle() + " » vers épargne libre"
        );
        auditLogService.recordAudit(userId, actorRole, "SAVINGS_GOAL_RELEASED", "SAVINGS_GOAL", goal.getId(), Map.of("amount", amount));
        return amount;
    }

    @Transactional
    public void deleteControlledGoal(String goalId, String userId, String actorRole) {
        SavingsGoalEntity goal = getGoalForUser(goalId, userId);
        if (goal.getCurrentAmount() != null && goal.getCurrentAmount().compareTo(BigDecimal.ZERO) > 0) {
            throw new ResponseStatusException(
                    HttpStatus.CONFLICT,
                    String.format("Suppression contrôlée : cet objectif contient encore %.2f USD. Libérez les fonds d'abord.", goal.getCurrentAmount().doubleValue())
            );
        }
        goal.setStatus("DELETED");
        goal.setUpdatedAt(OffsetDateTime.now());
        goalRepository.save(goal);
        auditLogService.recordAudit(userId, actorRole, "SAVINGS_GOAL_DELETED", "SAVINGS_GOAL", goal.getId(), Map.of("title", goal.getTitle()));
    }
}
