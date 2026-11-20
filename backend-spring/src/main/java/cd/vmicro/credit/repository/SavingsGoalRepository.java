package cd.vmicro.credit.repository;

import cd.vmicro.credit.entity.SavingsGoalEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface SavingsGoalRepository extends JpaRepository<SavingsGoalEntity, String> {
    List<SavingsGoalEntity> findByUserIdAndStatusNotOrderByCreatedAtDesc(String userId, String excludedStatus);
    Optional<SavingsGoalEntity> findByIdAndUserIdAndStatusNot(String id, String userId, String excludedStatus);
    Optional<SavingsGoalEntity> findByIdAndUserIdAndStatus(String id, String userId, String status);
}
