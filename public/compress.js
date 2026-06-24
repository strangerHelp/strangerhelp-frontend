// Client-side image compression - loaded on pages with file uploads
window.compressImage = function(file, maxWidth, quality) {
  maxWidth = maxWidth || 1200;
  quality = quality || 0.7;
  if (!file.type.startsWith('image/')) return Promise.resolve(file);
  if (file.size < 200 * 1024) return Promise.resolve(file);

  return new Promise(function(resolve) {
    var img = new Image();
    img.onload = function() {
      var width = img.width, height = img.height;
      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }
      var canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      canvas.toBlob(function(blob) {
        if (blob && blob.size < file.size) {
          resolve(new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' }));
        } else {
          resolve(file);
        }
      }, 'image/jpeg', quality);
    };
    img.onerror = function() { resolve(file); };
    img.src = URL.createObjectURL(file);
  });
};

window.compressFiles = async function(files) {
  var result = [];
  for (var i = 0; i < files.length; i++) {
    result.push(await window.compressImage(files[i]));
  }
  return result;
};
