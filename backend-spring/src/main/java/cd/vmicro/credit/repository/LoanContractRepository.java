package cd.vmicro.credit.repository;

import cd.vmicro.credit.entity.LoanContractEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface LoanContractRepository extends JpaRepository<LoanContractEntity, String> {
    List<LoanContractEntity> findByUserIdOrderByDisbursedAtDesc(String userId);
    List<LoanContractEntity> findByUserIdAndStatus(String userId, String status);
    Optional<LoanContractEntity> findByLoanApplicationId(String loanApplicationId);
    Optional<LoanContractEntity> findByLoanApplicationIdAndUserId(String loanApplicationId, String userId);
    Optional<LoanContractEntity> findByIdAndUserId(String id, String userId);
    List<LoanContractEntity> findAllByOrderByDisbursedAtDesc();
}
