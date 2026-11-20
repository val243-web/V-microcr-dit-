package cd.vmicro.credit.repository;

import cd.vmicro.credit.entity.AuditLogEntity;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface AuditLogRepository extends JpaRepository<AuditLogEntity, String> {
    List<AuditLogEntity> findAllByOrderByCreatedAtDesc(Pageable pageable);
    List<AuditLogEntity> findByActorIdOrderByCreatedAtDesc(String actorId, Pageable pageable);
    List<AuditLogEntity> findByActionContainingIgnoreCaseOrderByCreatedAtDesc(String action, Pageable pageable);
    List<AuditLogEntity> findByTargetTypeOrderByCreatedAtDesc(String targetType, Pageable pageable);
}
