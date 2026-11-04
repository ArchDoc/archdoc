resource "aws_s3_bucket" "web" {
  bucket = "bookings-web"
}

resource "aws_s3_bucket_website_configuration" "web" {
  bucket = aws_s3_bucket.web.id
  index_document { suffix = "index.html" }
}
