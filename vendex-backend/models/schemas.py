from enum import Enum
from typing import List, Optional, Literal
from pydantic import BaseModel, HttpUrl

class JobStatus(str, Enum):
    PENDING = "pending"
    DOWNLOADING = "downloading"
    EXTRACTING = "extracting"
    SEARCHING = "searching"
    NORMALIZING = "normalizing"
    COMPLETE = "complete"
    FAILED = "failed"

class Platform(str, Enum):
    INSTAGRAM = "instagram"
    TIKTOK = "tiktok"
    YOUTUBE = "youtube"
    FACEBOOK = "facebook"
    OTHER = "other"

class SupplierType(str, Enum):
    MANUFACTURER = "manufacturer"
    TRADING_COMPANY = "trading_company"
    DISTRIBUTOR = "distributor"
    SUPPLIER = "supplier"

class PipelineStage(BaseModel):
    stage: str
    status: Literal["pending", "running", "done", "failed"]
    message: str
    duration_ms: Optional[int] = None
    timestamp: str

class JobCreate(BaseModel):
    reel_url: HttpUrl
    platform: Optional[Platform] = None

class JobResponse(BaseModel):
    id: str
    reel_url: str
    platform: Platform
    status: JobStatus
    created_at: str
    updated_at: str
    extracted_frame_url: Optional[str] = None
    detected_product_name: Optional[str] = None
    detected_keywords: List[str] = []
    error_message: Optional[str] = None
    result_count: int = 0
    pipeline_stages: List[PipelineStage] = []
    progress_percent: int = 0

class SupplierResult(BaseModel):
    id: str
    job_id: str
    product_name: str
    product_description: Optional[str] = None
    product_image_url: str
    product_category: Optional[str] = None
    supplier_name: str
    supplier_type: SupplierType
    company_name: str
    country: str
    country_code: str
    city: Optional[str] = None
    verified: bool = False
    gold_supplier: bool = False
    trade_assurance: bool = False
    years_on_platform: Optional[int] = None
    unit_price_usd: Optional[float] = None
    unit_price_cny: Optional[float] = None
    unit_price_inr: float
    original_currency: str
    original_price: float
    price_range_min: Optional[float] = None
    price_range_max: Optional[float] = None
    moq: int
    moq_unit: str = "pieces"
    shipping_methods: List[str] = []
    estimated_shipping_cost_usd: Optional[float] = None
    estimated_shipping_cost_inr: Optional[float] = None
    total_price_inr: float
    estimated_delivery_days: Optional[int] = None
    rating: float = 0.0
    review_count: int = 0
    response_rate: Optional[str] = None
    response_time: Optional[str] = None
    warranty: Optional[str] = None
    certifications: List[str] = []
    sample_available: bool = False
    sample_price_usd: Optional[float] = None
    sample_price_inr: Optional[float] = None
    reorder_rate: Optional[str] = None
    on_time_delivery_rate: Optional[str] = None
    location: Optional[str] = None
    platform: str = "alibaba"
    product_url: str
    item_id: Optional[str] = None
    store_id: Optional[str] = None
    match_score: float
    match_source: Literal["visual", "keyword", "combined"]
    created_at: str
    product_properties: Optional[dict] = None
    raw_api_response: Optional[dict] = None

class BatchJobCreate(BaseModel):
    urls: List[str]

class ProcessResponse(BaseModel):
    job_id: str
    status: str
    message: str
