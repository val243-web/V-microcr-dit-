package cd.vmicro.credit.repository;

import cd.vmicro.credit.entity.RepaymentScheduleEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface RepaymentScheduleRepository extends JpaRepository<RepaymentScheduleEntity, String> {
    List<RepaymentScheduleEntity> findByContractIdOrderByInstallmentNumberAsc(String contractId);
    List<RepaymentScheduleEntity> findTop3ByContractIdAndStatusOrderByInstallmentNumberAsc(String contractId, String status);
    Optional<RepaymentScheduleEntity> findByIdAndContractId(String id, String contractId);
}
