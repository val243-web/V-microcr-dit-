package cd.vmicro.credit.entity;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.OffsetDateTime;

@Entity
@Table(name = "savings_goals")
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class SavingsGoalEntity {

    @Id
    @Column(length = 64, nullable = false)
    private String id;

    @Column(name = "user_id", length = 64, nullable = false)
    private String userId;

    @Column(length = 120, nullable = false)
    private String title;

    @Column(length = 64, nullable = false)
    private String category;

    @Column(name = "target_amount", precision = 14, scale = 2, nullable = false)
    private BigDecimal targetAmount;

    @Column(name = "current_amount", precision = 14, scale = 2, nullable = false)
    private BigDecimal currentAmount = BigDecimal.ZERO;

    @Column(name = "target_date", nullable = false)
    private LocalDate targetDate;

    @Column(length = 24, nullable = false)
    private String status = "ACTIVE";

    @Column(name = "created_at", nullable = false)
    private OffsetDateTime createdAt;

    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }

    public String getUserId() { return userId; }
    public void setUserId(String userId) { this.userId = userId; }

    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }

    public String getCategory() { return category; }
    public void setCategory(String category) { this.category = category; }

    public BigDecimal getTargetAmount() { return targetAmount; }
    public void setTargetAmount(BigDecimal targetAmount) { this.targetAmount = targetAmount; }

    public BigDecimal getCurrentAmount() { return currentAmount; }
    public void setCurrentAmount(BigDecimal currentAmount) { this.currentAmount = currentAmount; }

    public LocalDate getTargetDate() { return targetDate; }
    public void setTargetDate(LocalDate targetDate) { this.targetDate = targetDate; }

    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }

    public OffsetDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(OffsetDateTime createdAt) { this.createdAt = createdAt; }

    public OffsetDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(OffsetDateTime updatedAt) { this.updatedAt = updatedAt; }
}
