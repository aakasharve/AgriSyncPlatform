try {
    Invoke-WebRequest -Method Post "http://localhost:5048/test/seed"
} catch {
    Write-Host "Error Message: $($_.Exception.Message)"
    if ($_.Exception.Response) {
        $stream = $_.Exception.Response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        Write-Host "Response Body: $($reader.ReadToEnd())"
    }
}
