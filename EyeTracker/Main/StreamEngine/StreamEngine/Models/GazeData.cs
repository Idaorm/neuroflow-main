using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace StreamEngineTobii.Models
{
    public class GazeData
    {
        public double X { get; set; }
        public double Y { get; set; }
        public long Timestamp { get; set; } // Unix time in milliseconds
    }
}
