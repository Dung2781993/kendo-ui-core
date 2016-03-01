namespace Kendo.Mvc.UI
{
    using System;
    using System.Linq;
    using System.Collections.Generic;
    using System.Web.Routing;
    using Kendo.Mvc.Extensions;

    public class DiagramEditableSelectStrokeSettings : JsonObject
    {
        public DiagramEditableSelectStrokeSettings()
        {
            //>> Initialization
        
        //<< Initialization
        }

        //>> Fields
        
        public string Color { get; set; }
        
        public double? Width { get; set; }
        
        public string DashType { get; set; }
        
        //<< Fields

        protected override void Serialize(IDictionary<string, object> json)
        {
            //>> Serialization
        
            if (Color.HasValue())
            {
                json["color"] = Color;
            }
            
            if (Width.HasValue)
            {
                json["width"] = Width;
            }
                
            if (DashType.HasValue())
            {
                json["dashType"] = DashType;
            }
            
        //<< Serialization
        }
    }
}