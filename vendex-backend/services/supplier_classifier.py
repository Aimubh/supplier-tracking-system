from typing import List, Optional
from models.schemas import SupplierType

def classify_supplier(
    business_type: Optional[str],
    company_name: Optional[str], 
    certifications: List[str],
    product_categories_count: int = 1
) -> SupplierType:
    
    bt_lower = (business_type or "").lower()
    cn_lower = (company_name or "").lower()
    certs_upper = [c.upper() for c in certifications]
    
    mfg_keywords = ["manufacturer", "factory", "oem", "odm", "producer", "maker", "fabricator"]
    is_mfg_bt = any(k in bt_lower for k in mfg_keywords)
    is_mfg_cert = any(c in ["ISO", "CE", "FDA", "GMP"] for c in certs_upper)
    is_mfg_cn = cn_lower.endswith("manufacturing co.") or "factory" in cn_lower or "mfg" in cn_lower
    
    if is_mfg_bt or is_mfg_cert or is_mfg_cn:
        return SupplierType.MANUFACTURER
        
    trade_keywords = ["trading", "trade co", "agent", "sourcing", "import", "export", "international"]
    is_trade_bt = any(k in bt_lower for k in trade_keywords)
    is_trade_cn = any(k in cn_lower for k in ["trading", "international", "global", "import"])
    is_trade_cat = product_categories_count > 8
    
    if is_trade_bt or is_trade_cn or is_trade_cat:
        return SupplierType.TRADING_COMPANY
        
    dist_keywords = ["distributor", "wholesaler", "reseller"]
    if any(k in bt_lower for k in dist_keywords) or (4 <= product_categories_count <= 8):
        return SupplierType.DISTRIBUTOR
        
    return SupplierType.SUPPLIER
