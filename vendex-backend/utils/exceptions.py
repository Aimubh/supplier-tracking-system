class VendexError(Exception): pass
class DownloadError(VendexError): pass
class LoginRequiredError(DownloadError): pass
class RateLimitError(VendexError): pass
class IdentificationError(VendexError): pass
class SearchError(VendexError): pass
