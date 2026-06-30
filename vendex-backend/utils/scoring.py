from typing import List, Optional

def calculate_match_score(
    visual_keywords: List[str],
    product_name: str,
    verified: bool,
    gold_supplier: bool,
    trade_assurance: bool,
    years_on_platform: Optional[int],
    visual_confidence: float = 0.5,
    filled_fields: int = 20,
    total_fields: int = 30
) -> float:
    product_name_lower = product_name.lower()
    overlap_count = sum(1 for kw in visual_keywords if kw.lower() in product_name_lower)
    keyword_overlap_score = overlap_count / max(len(visual_keywords), 1)
    
    trust_score = 0.0
    if verified: trust_score += 0.3
    if gold_supplier: trust_score += 0.4
    if trade_assurance: trust_score += 0.3
    
    years = min(years_on_platform or 0, 5)
    trust_score = trust_score * (years / 5.0 if years > 0 else 0.5)
    
    completeness_score = min(filled_fields / total_fields, 1.0)
    
    score = (
        keyword_overlap_score * 0.40 +
        trust_score * 0.25 +
        completeness_score * 0.20 +
        visual_confidence * 0.15
    )
    
    return round(min(score * 100, 100.0), 1)
